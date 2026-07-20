import { v4 as uuid } from "uuid";
import { prisma } from "../utils/prisma";
import { HttpError } from "../utils/httpError";
import { createNotificationService } from "./notificationsService";
import { spendCredits } from "./creditService";
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
  const learner = await prisma.user.findUnique({
    where: { id: learnerId },
    select: { id: true },
  });
  if (!learner) throw new HttpError(404, "Learner not found");

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

  await prisma.$transaction([
    prisma.user.update({
      where: { id: session.teacherId },
      data: { credits: { increment: teacherCreditsPaid } },
    }),
    ...(learnerCreditsRefunded > 0
      ? [
          prisma.user.update({
            where: { id: session.learnerId },
            data: { credits: { increment: learnerCreditsRefunded } },
          }),
        ]
      : []),
    prisma.teachingSession.update({
      where: { id: sessionId },
      data: {
        status: "COMPLETED",
        actualEndedAt: new Date(),
        creditsConsumed: teacherCreditsPaid,
      },
    }),
  ]);

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
    await spendCredits(tx, learnerId, session.creditsReserved);
    await tx.rewardTransaction.create({
      data: {
        userId: learnerId,
        amount: session.creditsReserved,
        type: "SPENT",
        description: `Réservation session acceptée : "${session.title}"`,
      },
    });
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
      if (learner.credits < estimatedDuration) {
        throw new HttpError(400, "Learner does not have enough credits");
      }
      await tx.user.update({
        where: { id: learner.id },
        data: { credits: { decrement: estimatedDuration } },
      });
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
    await tx.user.update({
      where: { id: userId },
      data: { credits: { decrement: session.creditsReserved } },
    });
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
    await tx.user.update({
      where: { id: userId },
      data: { credits: { increment: session.creditsReserved } },
    });
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
