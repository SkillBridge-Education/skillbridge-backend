import { v4 as uuid } from "uuid";
import { prisma } from "../utils/prisma";
import { HttpError } from "../utils/httpError";
import { assertNotBlocked } from "./blockService";
import { createNotificationService } from "./notificationsService";
import { grantCredits, spendCredits } from "./creditService";
import { grantLoyaltyRewardIfDue, isSchoolSession } from "./rewardService";
import { emitToUser } from "../sockets";

const emitSessionUpdate = (session: { id: string; teacherId: string; learnerId: string; status: string }): void => {
  emitToUser(session.teacherId, "session:update", session);
  emitToUser(session.learnerId, "session:update", session);
};

export const createSessionService = async (
  teacherId: string,
  learnerId: string,
  title: string,
  estimatedDuration: number,
  scheduledAt: Date
) => {
  /**
   * Teaching yourself is not a session.
   *
   * Nothing refused it before, and the loop it allowed was profitable: create,
   * accept, join and end a session with yourself on both sides. The balance
   * nets out, but each pass adds a COMPLETED session, and the loyalty reward
   * counts completed sessions without filtering — fifty passes minted 200
   * credits, deliberately over the cap.
   */
  if (teacherId === learnerId) {
    throw new HttpError(400, "Vous ne pouvez pas creer une session avec vous-meme");
  }

  const learner = await prisma.user.findUnique({
    where: { id: learnerId },
    select: { id: true },
  });
  if (!learner) throw new HttpError(404, "Learner not found");

  await assertNotBlocked(teacherId, learnerId);

  const jitsiRoomId = `skillbridge-${uuid()}`;
  const session = await prisma.teachingSession.create({
    data: {
      jitsiRoomId,
      teacherId,
      learnerId,
      title,
      creditsReserved: estimatedDuration,
      startsAt: scheduledAt,
      status: "PENDING_CONFIRMATION",
    },
  });

  createNotificationService(
    learnerId,
    "SESSION_BOOKED",
    `Proposition de session "${title}" reçue. ${estimatedDuration} crédits requis pour accepter. Acceptez ou refusez.`
  ).catch(() => {});

  emitSessionUpdate(session);

  return session;
};

export const endSessionService = async (
  sessionId: string,
  userId: string,
  durationSeconds: number
): Promise<{ teacherCreditsPaid: number; learnerCreditsRefunded: number }> => {
  const session = await prisma.teachingSession.findUnique({
    where: { id: sessionId },
    select: {
      teacherId: true,
      learnerId: true,
      creditsReserved: true,
      status: true,
    },
  });

  if (!session) throw new HttpError(404, "Session not found");
  if (session.teacherId !== userId && session.learnerId !== userId) {
    throw new HttpError(403, "User is not part of this session");
  }
  if (session.status !== "ACTIVE") {
    throw new HttpError(400, "Session is not active");
  }

  const minutesElapsed = Math.ceil(durationSeconds / 60);
  const teacherCreditsPaid = Math.min(minutesElapsed, session.creditsReserved);
  const learnerCreditsRefunded = session.creditsReserved - teacherCreditsPaid;

  // grantCredits caps at MAX_CREDITS; a raw increment would break the
  // "User_credits_bounds_check" constraint and roll back the whole settlement.
  await prisma.$transaction(async (tx) => {
    /**
     * Claims the session before paying anyone.
     *
     * The status was read outside this transaction, and the update below did
     * not re-check it — so two clients ending the same session at once could
     * both pass the check above and both settle it, paying the teacher twice.
     * Moving the transition first, guarded on the status we read, makes the
     * loser of the race fail before any credit moves.
     */
    const claimed = await tx.teachingSession.updateMany({
      where: { id: sessionId, status: "ACTIVE" },
      data: { status: "COMPLETED", actualEndedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new HttpError(409, "Cette session a deja ete terminee");
    }

    // School sessions sit outside the credit economy entirely: the learner was
    // never charged on accept, so there is nothing to settle or refund here.
    const schoolSession = await isSchoolSession(tx, session.teacherId);

    if (!schoolSession) {
      await grantCredits(tx, session.teacherId, teacherCreditsPaid);

      if (learnerCreditsRefunded > 0) {
        await grantCredits(tx, session.learnerId, learnerCreditsRefunded);
      }
    }

    // The transition itself was claimed above; this records what it cost.
    await tx.teachingSession.update({
      where: { id: sessionId },
      data: { creditsConsumed: schoolSession ? 0 : teacherCreditsPaid },
    });

    // Counted after the session is marked COMPLETED so it is included, and
    // awarded to school teachers too — the milestone rewards teaching, not
    // earning.
    await grantLoyaltyRewardIfDue(tx, session.teacherId);
  });

  emitSessionUpdate({
    id: sessionId,
    teacherId: session.teacherId,
    learnerId: session.learnerId,
    status: "COMPLETED",
  });

  return { teacherCreditsPaid, learnerCreditsRefunded };
};

export const joinSessionService = async (
  sessionId: string,
  userId: string
) => {
  const session = await prisma.teachingSession.findUnique({
    where: { id: sessionId },
    select: {
      teacherId: true,
      learnerId: true,
      status: true,
      jitsiRoomId: true,
    },
  });

  if (!session) throw new HttpError(404, "Session not found");
  if (session.teacherId !== userId && session.learnerId !== userId) {
    throw new HttpError(403, "User is not part of this session");
  }
  if (session.status === "COMPLETED" || session.status === "CANCELLED") {
    throw new HttpError(400, "Session has already ended");
  }
  if (session.status === "PENDING_CONFIRMATION") {
    throw new HttpError(400, "Session is awaiting learner confirmation");
  }
  if (session.status === "SCHEDULED") {
    await prisma.teachingSession.update({
      where: { id: sessionId },
      data: { status: "ACTIVE", actualStartedAt: new Date() },
    });
    emitSessionUpdate({
      id: sessionId,
      teacherId: session.teacherId,
      learnerId: session.learnerId,
      status: "ACTIVE",
    });
  }
  return session.jitsiRoomId;
};

export const acceptSessionService = async (
  sessionId: string,
  learnerId: string
) => {
  const session = await prisma.teachingSession.findUnique({
    where: { id: sessionId },
    select: { teacherId: true, learnerId: true, status: true, title: true, creditsReserved: true },
  });
  if (!session) throw new HttpError(404, "Session not found");
  if (session.learnerId !== learnerId) {
    throw new HttpError(403, "Only the learner can accept this session");
  }
  if (session.status !== "PENDING_CONFIRMATION") {
    throw new HttpError(400, "Session is not pending confirmation");
  }

  // spendCredits throws 400 "User does not have enough credits" if insufficient
  const updated = await prisma.$transaction(async (tx) => {
    // School mode has no credit economy: a lesson from a school teacher costs
    // the student nothing, so a student with an empty balance is never turned
    // away from their own school.
    if (!(await isSchoolSession(tx, session.teacherId))) {
      await spendCredits(tx, learnerId, session.creditsReserved);
      await tx.rewardTransaction.create({
        data: {
          userId: learnerId,
          amount: session.creditsReserved,
          type: "SPENT",
          description: `Réservation session acceptée : "${session.title}"`,
        },
      });
    }

    return tx.teachingSession.update({
      where: { id: sessionId },
      data: { status: "SCHEDULED" },
    });
  });

  createNotificationService(
    session.teacherId,
    "SESSION_ACCEPTED",
    `Votre session "${session.title}" a été acceptée.`
  ).catch(() => {});

  emitSessionUpdate({
    id: sessionId,
    teacherId: session.teacherId,
    learnerId: session.learnerId,
    status: updated.status,
  });

  return updated;
};

export const refuseSessionService = async (
  sessionId: string,
  learnerId: string
) => {
  const session = await prisma.teachingSession.findUnique({
    where: { id: sessionId },
    select: {
      teacherId: true,
      learnerId: true,
      status: true,
      title: true,
    },
  });
  if (!session) throw new HttpError(404, "Session not found");
  if (session.learnerId !== learnerId) {
    throw new HttpError(403, "Only the learner can refuse this session");
  }
  if (session.status !== "PENDING_CONFIRMATION") {
    throw new HttpError(400, "Session is not pending confirmation");
  }

  // No credits were debited at creation, so nothing to refund here.
  const updated = await prisma.teachingSession.update({
    where: { id: sessionId },
    data: { status: "CANCELLED" },
  });

  createNotificationService(
    session.teacherId,
    "SESSION_REFUSED",
    `Votre session "${session.title}" a été refusée par l'apprenant.`
  ).catch(() => {});

  emitSessionUpdate({
    id: sessionId,
    teacherId: session.teacherId,
    learnerId: session.learnerId,
    status: updated.status,
  });

  return updated;
};

export const createGroupSessionService = async (
  teacherId: string,
  learnerIds: string[],
  title: string,
  estimatedDuration: number,
  scheduledAt: Date
) => {
  const learners = await prisma.user.findMany({
    where: { id: { in: learnerIds } },
    select: { id: true, credits: true },
  });
  if (learners.length !== learnerIds.length) {
    throw new HttpError(404, "One or more learners not found");
  }

  const jitsiRoomId = `skillbridge-${uuid()}`;
  return prisma.$transaction(async (tx) => {
    for (const learner of learners) {
      // The balances read outside the transaction can be stale, so let
      // spendCredits do the check and the debit in a single atomic write.
      await spendCredits(tx, learner.id, estimatedDuration);
    }

    const session = await tx.teachingSession.create({
      data: {
        jitsiRoomId,
        teacherId,
        learnerId: learnerIds[0],
        title,
        startsAt: scheduledAt,
        creditsReserved: estimatedDuration * learnerIds.length,
      },
    });

    await tx.sessionParticipant.createMany({
      data: [
        { sessionId: session.id, userId: teacherId, role: "TEACHER" },
        ...learnerIds.map((id) => ({
          sessionId: session.id,
          userId: id,
          role: "LEARNER" as const,
        })),
      ],
    });

    return session;
  });
};

export const updateSessionService = async (
  sessionId: string,
  teacherId: string,
  body: { estimatedDuration?: number; scheduledAt?: string; title?: string }
) => {
  const session = await prisma.teachingSession.findUnique({
    where: { id: sessionId },
    select: {
      teacherId: true,
      learnerId: true,
      status: true,
      title: true,
      creditsReserved: true,
    },
  });
  if (!session) throw new HttpError(404, "Session not found");
  if (session.teacherId !== teacherId) {
    throw new HttpError(403, "Only the teacher can modify this session");
  }
  if (session.status !== "CANCELLED" && session.status !== "PENDING_CONFIRMATION") {
    throw new HttpError(400, "Only cancelled or pending sessions can be modified");
  }

  const newCredits =
    body.estimatedDuration !== undefined
      ? body.estimatedDuration
      : session.creditsReserved;

  // Credits are only debited at acceptance, not at creation/modification.
  // No credit movement needed here for PENDING or CANCELLED sessions.
  const updated = await prisma.teachingSession.update({
    where: { id: sessionId },
    data: {
      creditsReserved: newCredits,
      status: "PENDING_CONFIRMATION",
      ...(body.scheduledAt ? { startsAt: new Date(body.scheduledAt) } : {}),
      ...(body.title ? { title: body.title } : {}),
    },
  });

  createNotificationService(
    session.learnerId,
    "SESSION_BOOKED",
    `La session "${updated.title}" a été modifiée. ${updated.creditsReserved} crédits requis pour accepter. Confirmez ou refusez.`
  ).catch(() => {});

  emitSessionUpdate({
    id: sessionId,
    teacherId: session.teacherId,
    learnerId: session.learnerId,
    status: updated.status,
  });

  return updated;
};

export const addParticipantSessionService = async (
  sessionId: string,
  requesterId: string,
  userId: string
) => {
  const session = await prisma.teachingSession.findUnique({
    where: { id: sessionId },
    select: { teacherId: true, status: true, creditsReserved: true },
  });
  if (!session) throw new HttpError(404, "Session not found");
  if (session.teacherId !== requesterId) {
    throw new HttpError(403, "Only the teacher can add participants");
  }
  if (session.status !== "SCHEDULED" && session.status !== "ACTIVE") {
    throw new HttpError(400, "Cannot add participants to a completed session");
  }

  const existing = await prisma.sessionParticipant.findUnique({
    where: { sessionId_userId: { sessionId, userId } },
  });
  if (existing) throw new HttpError(400, "User is already a participant");

  const learner = await prisma.user.findUnique({
    where: { id: userId },
    select: { credits: true },
  });
  if (!learner) throw new HttpError(404, "User not found");
  if (learner.credits < session.creditsReserved) {
    throw new HttpError(400, "User does not have enough credits");
  }

  return prisma.$transaction(async (tx) => {
    // spendCredits re-checks the balance atomically; the read above can go stale
    // between the check and the write when a user joins two sessions at once.
    await spendCredits(tx, userId, session.creditsReserved);
    return tx.sessionParticipant.create({
      data: { sessionId, userId, role: "LEARNER" },
    });
  });
};

export const removeParticipantSessionService = async (
  sessionId: string,
  requesterId: string,
  userId: string
) => {
  const session = await prisma.teachingSession.findUnique({
    where: { id: sessionId },
    select: { teacherId: true, status: true, creditsReserved: true },
  });
  if (!session) throw new HttpError(404, "Session not found");
  if (session.teacherId !== requesterId) {
    throw new HttpError(403, "Only the teacher can remove participants");
  }
  if (session.status !== "SCHEDULED") {
    throw new HttpError(400, "Cannot remove participants from a non-scheduled session");
  }

  const existing = await prisma.sessionParticipant.findUnique({
    where: { sessionId_userId: { sessionId, userId } },
  });
  if (!existing) throw new HttpError(404, "User is not a participant");

  return prisma.$transaction(async (tx) => {
    await grantCredits(tx, userId, session.creditsReserved);
    return tx.sessionParticipant.delete({
      where: { sessionId_userId: { sessionId, userId } },
    });
  });
};

export const getParticipantsSessionService = async (
  sessionId: string,
  requesterId: string
) => {
  const session = await prisma.teachingSession.findUnique({
    where: { id: sessionId },
    select: { teacherId: true, status: true },
  });
  if (!session) throw new HttpError(404, "Session not found");

  const participant = await prisma.sessionParticipant.findUnique({
    where: { sessionId_userId: { sessionId, userId: requesterId } },
  });
  if (!participant && session.teacherId !== requesterId) {
    throw new HttpError(403, "You are not a participant of this session");
  }

  return prisma.sessionParticipant.findMany({
    where: { sessionId },
    include: {
      user: {
        select: { id: true, firstName: true, lastName: true, avatarUrl: true },
      },
    },
  });
};

/**
 * Cancels a session that has not started, from either side.
 *
 * This existed nowhere, and its absence trapped credits. Accepting a session
 * debits the learner immediately; after that `refuse` refused (it only accepts
 * PENDING_CONFIRMATION) and `end` refused (it only accepts ACTIVE), so the only
 * way to get those credits back was to hold the session for real. The web
 * "Annuler" button called `end` and simply failed.
 *
 * The refund is the whole point, so it happens in the same transaction as the
 * status change: a cancellation that records itself without giving the credits
 * back is the bug it replaces.
 */
export const cancelSessionService = async (sessionId: string, userId: string) => {
  const session = await prisma.teachingSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      teacherId: true,
      learnerId: true,
      status: true,
      title: true,
      creditsReserved: true,
    },
  });
  if (!session) throw new HttpError(404, "Session not found");

  // Both sides may call off a session that has not begun. Only the learner
  // could refuse before, which left the teacher no way out of a booking.
  if (session.teacherId !== userId && session.learnerId !== userId) {
    throw new HttpError(403, "Vous ne participez pas a cette session");
  }

  if (session.status !== "PENDING_CONFIRMATION" && session.status !== "SCHEDULED") {
    throw new HttpError(
      400,
      session.status === "ACTIVE"
        ? "Cette session a commence : terminez-la plutot que de l'annuler"
        : "Cette session ne peut plus etre annulee"
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    // Only a SCHEDULED session has been paid for; a pending one never was.
    if (session.status === "SCHEDULED") {
      const schoolSession = await isSchoolSession(tx, session.teacherId);
      if (!schoolSession && session.creditsReserved > 0) {
        await grantCredits(tx, session.learnerId, session.creditsReserved);
        await tx.rewardTransaction.create({
          data: {
            userId: session.learnerId,
            amount: session.creditsReserved,
            type: "EARNED",
            description: `Remboursement : session "${session.title}" annulee`,
          },
        });
      }
    }

    // Guarded on the status we read, so two concurrent cancellations cannot
    // both refund.
    const result = await tx.teachingSession.updateMany({
      where: { id: sessionId, status: session.status },
      data: { status: "CANCELLED" },
    });
    if (result.count === 0) {
      throw new HttpError(409, "Cette session vient d'etre modifiee, reessayez");
    }

    return tx.teachingSession.findUniqueOrThrow({ where: { id: sessionId } });
  });

  const otherId = session.teacherId === userId ? session.learnerId : session.teacherId;
  createNotificationService(
    otherId,
    "SESSION_REFUSED",
    `La session "${session.title}" a ete annulee.`
  ).catch(() => {});

  emitSessionUpdate({
    id: sessionId,
    teacherId: session.teacherId,
    learnerId: session.learnerId,
    status: updated.status,
  });

  return updated;
};
