import { UserStatus } from "@prisma/client";
import { prisma } from "../utils/prisma";

/**
 * Figures shown on the Discover screen. Every number here is computed from real
 * rows — the design mocked up plausible-looking values, but a statistic the
 * product invents is a lie the user has no way to check.
 */

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export const getCommunityStats = async () => {
  const since = new Date(Date.now() - ONE_WEEK_MS);

  const [totalMembers, ratingAggregate, sessionsThisWeek, activeTeachers, activeLearners] =
    await Promise.all([
      prisma.user.count({ where: { status: UserStatus.ACTIVE } }),

      // Averaging User.averageRating would weight a member with one review the
      // same as one with fifty, so average the ratings themselves.
      prisma.sessionRating.aggregate({ _avg: { rating: true }, _count: { _all: true } }),

      prisma.teachingSession.count({
        where: { status: "COMPLETED", actualEndedAt: { gte: since } },
      }),

      // "Active this week" means took part in a session — there is no presence
      // or last-seen tracking, and inventing one would misreport it.
      prisma.teachingSession.findMany({
        where: { createdAt: { gte: since } },
        select: { teacherId: true },
        distinct: ["teacherId"],
      }),
      prisma.teachingSession.findMany({
        where: { createdAt: { gte: since } },
        select: { learnerId: true },
        distinct: ["learnerId"],
      }),
    ]);

  const activeThisWeek = new Set([
    ...activeTeachers.map((row) => row.teacherId),
    ...activeLearners.map((row) => row.learnerId),
  ]).size;

  const average = ratingAggregate._avg.rating;

  return {
    members: { total: totalMembers, activeThisWeek },
    rating: {
      // null rather than 0 when nobody has been rated: "0/5" would read as a
      // terrible community rather than an empty one.
      average: average === null ? null : Math.round(average * 10) / 10,
      totalReviews: ratingAggregate._count._all,
    },
    sessions: { completedThisWeek: sessionsThisWeek },
  };
};

/** A few members to illustrate the community, newest first. */
export const getFeaturedMembers = async (limit = 3) =>
  prisma.user.findMany({
    where: { status: UserStatus.ACTIVE, teachingSkills: { some: {} } },
    select: { id: true, firstName: true, lastName: true, avatarUrl: true },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
