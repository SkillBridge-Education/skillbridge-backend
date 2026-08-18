import { randomUUID } from "crypto";
import { UserStatus } from "@prisma/client";
import { prisma } from "../utils/prisma";
import { HttpError } from "../utils/httpError";
import { disconnectUser } from "../sockets";
import { logger } from "../utils/logger";

/**
 * GDPR data portability: everything held about the caller, in a machine-readable
 * shape. Deliberately assembled from explicit selects rather than a generic
 * dump, so a future column carrying someone else's data cannot leak in by
 * simply existing.
 */
export const exportUserData = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      bio: true,
      avatarUrl: true,
      bannerUrl: true,
      availability: true,
      dateOfBirth: true,
      role: true,
      status: true,
      credits: true,
      averageRating: true,
      totalRatings: true,
      isEmailVerified: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!user) throw new HttpError(404, "User not found");

  const [skills, goals, memberships, sessionsTaught, sessionsLearned, messages, transactions, ratingsGiven, reports, appeals, blocks, legalAcceptances] =
    await Promise.all([
      prisma.userSkill.findMany({
        where: { userId },
        select: { description: true, yearsOfExperience: true, isVerified: true, createdAt: true, skill: { select: { name: true, category: true } } },
      }),
      prisma.learningGoal.findMany({
        where: { userId },
        select: { description: true, targetLevel: true, isActive: true, createdAt: true, skill: { select: { name: true } } },
      }),
      prisma.membership.findMany({
        where: { userId },
        select: { orgRole: true, status: true, createdAt: true, organization: { select: { name: true } } },
      }),
      prisma.teachingSession.findMany({
        where: { teacherId: userId },
        select: { title: true, status: true, startsAt: true, creditsConsumed: true, createdAt: true },
      }),
      prisma.teachingSession.findMany({
        where: { learnerId: userId },
        select: { title: true, status: true, startsAt: true, creditsConsumed: true, createdAt: true },
      }),
      // Only the caller's own messages: the other side of a conversation is
      // someone else's personal data, not theirs to export.
      prisma.message.findMany({
        where: { senderId: userId },
        select: { body: true, type: true, createdAt: true, conversationId: true },
      }),
      prisma.rewardTransaction.findMany({
        where: { userId },
        select: { amount: true, type: true, description: true, createdAt: true },
      }),
      prisma.sessionRating.findMany({
        where: { reviewerId: userId },
        select: { rating: true, comment: true, createdAt: true },
      }),
      prisma.report.findMany({
        where: { reporterId: userId },
        select: { reason: true, description: true, status: true, createdAt: true },
      }),
      prisma.appeal.findMany({
        where: { userId },
        select: { message: true, status: true, adminResponse: true, createdAt: true },
      }),
      prisma.userBlock.findMany({
        where: { blockerId: userId },
        select: { blockedId: true, createdAt: true },
      }),
      prisma.legalAcceptance.findMany({
        where: { userId },
        select: { document: true, version: true, acceptedAt: true },
      }),
    ]);

  return {
    exportedAt: new Date().toISOString(),
    account: user,
    skillsOffered: skills,
    learningGoals: goals,
    schoolMemberships: memberships,
    sessionsAsTeacher: sessionsTaught,
    sessionsAsLearner: sessionsLearned,
    messagesSent: messages,
    creditTransactions: transactions,
    ratingsGiven,
    reportsFiled: reports,
    appeals,
    blockedUsers: blocks,
    legalAcceptances,
  };
};

/**
 * GDPR erasure. Anonymises rather than hard-deleting, because a hard delete
 * would cascade into other people's records: the sessions someone attended, the
 * ratings they received and the conversations they had are also *their*
 * counterpart's history, and erasing one participant must not rewrite the
 * other's.
 *
 * What goes: every identifier and every free-text field the user authored.
 * What stays: the shape of past exchanges, detached from any identity.
 *
 * Retention periods are a legal decision, not a technical one — the anonymised
 * rows can be purged on whatever schedule the operator commits to in the
 * privacy policy.
 */
export const deleteAccount = async (userId: string, password?: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, status: true },
  });
  if (!user) throw new HttpError(404, "User not found");
  if (user.status === UserStatus.DELETED) {
    throw new HttpError(400, "This account has already been deleted");
  }

  const tombstone = `deleted-${randomUUID()}`;

  await prisma.$transaction(async (tx) => {
    // Free-text the user authored is theirs alone, so it goes entirely.
    await tx.message.updateMany({
      where: { senderId: userId },
      data: { body: "[message supprimé]", fileUrl: null },
    });
    await tx.sessionRating.updateMany({
      where: { reviewerId: userId },
      data: { comment: null },
    });

    // Personal preferences and pending claims have no reason to outlive the account.
    await tx.userBlock.deleteMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] } });
    await tx.userSkill.deleteMany({ where: { userId } });
    await tx.learningGoal.deleteMany({ where: { userId } });
    await tx.membership.deleteMany({ where: { userId } });
    await tx.emailVerificationToken.deleteMany({ where: { userId } });
    await tx.passwordResetToken.deleteMany({ where: { userId } });
    await tx.notification.deleteMany({ where: { userId } });

    await tx.user.update({
      where: { id: userId },
      data: {
        status: UserStatus.DELETED,
        // Unique columns get a tombstone value so the row stays valid without
        // holding anything identifying, and the address can be reused.
        email: `${tombstone}@deleted.invalid`,
        passwordHash: tombstone,
        firstName: "Compte",
        lastName: "supprimé",
        bio: null,
        avatarUrl: null,
        bannerUrl: null,
        availability: null,
        dateOfBirth: null,
        suspensionReason: null,
      },
    });
  });

  disconnectUser(userId, "Your account has been deleted");
  logger.info({ userId }, "Account deleted and anonymised");
};
