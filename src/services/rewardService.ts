import { MembershipStatus, Prisma } from "@prisma/client";
import { prisma } from "../utils/prisma";
import { MAX_CREDITS } from "./creditService";

/**
 * Loyalty reward and school-mode exemption.
 *
 * Two product rules that both hang off "is this session part of a school".
 */

/** Courses taught before the bonus lands, and what it is worth. */
export const REWARD_THRESHOLD_SESSIONS = 50;
export const REWARD_CREDITS = 200;

/**
 * School sessions sit outside the credit economy: the learner is not charged
 * and the teacher is not paid. A salaried teacher has no reason to accumulate a
 * currency whose only use is buying lessons.
 *
 * Decided by the *teacher's* membership: a school teacher giving a lesson is
 * school business, whichever hat the learner is wearing.
 */
export const isSchoolSession = async (
  tx: Prisma.TransactionClient,
  teacherId: string
): Promise<boolean> => {
  const membership = await tx.membership.findFirst({
    where: {
      userId: teacherId,
      status: MembershipStatus.ACTIVE,
      orgRole: { in: ["TEACHER", "ORG_ADMIN"] },
      organization: { status: "ACTIVE" },
    },
    select: { id: true },
  });

  return membership !== null;
};

/**
 * Grants the loyalty bonus when a teacher crosses the threshold, once.
 *
 * Deliberately bypasses the MAX_CREDITS ceiling: the reward is meant to be felt,
 * and capping it would silently pay less than advertised to exactly the people
 * who earned it most. The database CHECK allows values up to MAX_CREDITS, so the
 * bonus is written with a raw update and its own bound.
 *
 * Idempotent: keyed on the count of completed sessions, and skipped when a
 * reward transaction already exists for this threshold.
 */
export const grantLoyaltyRewardIfDue = async (
  tx: Prisma.TransactionClient,
  teacherId: string
): Promise<number | null> => {
  const completed = await tx.teachingSession.count({
    where: { teacherId, status: "COMPLETED" },
  });

  if (completed < REWARD_THRESHOLD_SESSIONS) return null;

  // How many thresholds this teacher has crossed, and how many were already paid.
  const milestone = Math.floor(completed / REWARD_THRESHOLD_SESSIONS);
  const description = `Loyalty reward for ${milestone * REWARD_THRESHOLD_SESSIONS} sessions taught`;

  const alreadyPaid = await tx.rewardTransaction.findFirst({
    where: { userId: teacherId, type: "EARNED", description },
    select: { id: true },
  });
  if (alreadyPaid) return null;

  await tx.rewardTransaction.create({
    data: { userId: teacherId, amount: REWARD_CREDITS, type: "EARNED", description },
  });

  // The reward may exceed the normal ceiling, so it is applied directly rather
  // than through grantCredits, which would clamp it to MAX_CREDITS.
  const hardCeiling = MAX_CREDITS + REWARD_CREDITS;
  await tx.$executeRaw`
    UPDATE "User"
    SET "credits" = LEAST(${hardCeiling}, "credits" + ${REWARD_CREDITS})
    WHERE "id" = ${teacherId}
  `;

  return REWARD_CREDITS;
};
