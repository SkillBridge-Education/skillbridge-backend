import { UserStatus } from "@prisma/client";
import { prisma } from "../utils/prisma";

/**
 * Figures for the back-office dashboard.
 *
 * Shaped to the contract the dashboard already declares rather than to what was
 * convenient to query: a stats screen that has to reshape every response is a
 * stats screen that will disagree with the API sooner or later.
 */

const daysAgo = (days: number): Date => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
};

/** Percentage change, guarding the case where the previous period was empty. */
const delta = (current: number, previous: number): number => {
  if (previous === 0) return current === 0 ? 0 : 100;
  return Math.round(((current - previous) / previous) * 100);
};

export interface DashboardStats {
  totalUsers: number;
  activeUsers30d: number;
  newUsers7d: number;
  sessionsCompleted30d: number;
  creditsInCirculation: number;
  openReports: number;
  pendingOrganizations: number;
  openTickets: number;
  deltas: {
    totalUsers: number;
    activeUsers30d: number;
    sessionsCompleted30d: number;
    creditsInCirculation: number;
  };
}

/**
 * Users who did something in the window — took part in a session or sent a
 * message. There is no session or page tracking, so "active" means acted, which
 * is both measurable and the more honest reading.
 */
const activeUserCount = async (from: Date, to: Date): Promise<number> => {
  const [teachers, learners, senders] = await Promise.all([
    prisma.teachingSession.findMany({
      where: { createdAt: { gte: from, lt: to } },
      select: { teacherId: true },
      distinct: ["teacherId"],
    }),
    prisma.teachingSession.findMany({
      where: { createdAt: { gte: from, lt: to } },
      select: { learnerId: true },
      distinct: ["learnerId"],
    }),
    prisma.message.findMany({
      where: { createdAt: { gte: from, lt: to } },
      select: { senderId: true },
      distinct: ["senderId"],
    }),
  ]);

  return new Set([
    ...teachers.map((r) => r.teacherId),
    ...learners.map((r) => r.learnerId),
    ...senders.map((r) => r.senderId),
  ]).size;
};

export const getDashboardStats = async (): Promise<DashboardStats> => {
  const now = new Date();
  const d7 = daysAgo(7);
  const d30 = daysAgo(30);
  const d60 = daysAgo(60);

  const [
    totalUsers,
    totalUsersBefore,
    newUsers7d,
    sessions30d,
    sessionsPrev30d,
    creditsNow,
    openReports,
    pendingOrganizations,
    openTickets,
    active30d,
    activePrev30d,
  ] = await Promise.all([
    prisma.user.count({ where: { status: { not: UserStatus.DELETED } } }),
    prisma.user.count({
      where: { status: { not: UserStatus.DELETED }, createdAt: { lt: d30 } },
    }),
    prisma.user.count({ where: { createdAt: { gte: d7 } } }),
    prisma.teachingSession.count({
      where: { status: "COMPLETED", actualEndedAt: { gte: d30 } },
    }),
    prisma.teachingSession.count({
      where: { status: "COMPLETED", actualEndedAt: { gte: d60, lt: d30 } },
    }),
    prisma.user.aggregate({
      where: { status: { not: UserStatus.DELETED } },
      _sum: { credits: true },
    }),
    prisma.report.count({ where: { status: { in: ["PENDING", "REVIEWING"] } } }),
    prisma.organization.count({ where: { status: "PENDING" } }),
    prisma.supportTicket.count({ where: { status: "OPEN" } }),
    activeUserCount(d30, now),
    activeUserCount(d60, d30),
  ]);

  const creditsInCirculation = creditsNow._sum.credits ?? 0;

  // Credits are not snapshotted, so the previous total is reconstructed by
  // undoing the recorded movements of the period rather than guessed.
  const movements = await prisma.rewardTransaction.aggregate({
    where: { createdAt: { gte: d30 } },
    _sum: { amount: true },
  });
  const creditsBefore = creditsInCirculation - (movements._sum.amount ?? 0);

  return {
    totalUsers,
    activeUsers30d: active30d,
    newUsers7d,
    sessionsCompleted30d: sessions30d,
    creditsInCirculation,
    openReports,
    pendingOrganizations,
    openTickets,
    deltas: {
      totalUsers: delta(totalUsers, totalUsersBefore),
      activeUsers30d: delta(active30d, activePrev30d),
      sessionsCompleted30d: delta(sessions30d, sessionsPrev30d),
      creditsInCirculation: delta(creditsInCirculation, creditsBefore),
    },
  };
};

export interface TimeseriesPoint {
  date: string;
  visits: number;
  signups: number;
  sessions: number;
}

/**
 * One point per day. `visits` is the number of distinct people who did
 * something that day — nothing counts page views, and reporting a made-up
 * number under that name would be worse than reporting activity honestly.
 */
export const getTimeseries = async (days: number): Promise<TimeseriesPoint[]> => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));

  const [signups, sessions, messages] = await Promise.all([
    prisma.user.findMany({
      where: { createdAt: { gte: start } },
      select: { createdAt: true },
    }),
    prisma.teachingSession.findMany({
      where: { createdAt: { gte: start } },
      select: { createdAt: true, teacherId: true, learnerId: true },
    }),
    prisma.message.findMany({
      where: { createdAt: { gte: start } },
      select: { createdAt: true, senderId: true },
    }),
  ]);

  const key = (date: Date): string => date.toISOString().slice(0, 10);

  // Every day is present, including empty ones: a chart that skips quiet days
  // flatters the numbers.
  const points = new Map<string, { signups: number; sessions: number; actors: Set<string> }>();
  for (let offset = 0; offset < days; offset += 1) {
    const date = new Date(start);
    date.setDate(date.getDate() + offset);
    points.set(key(date), { signups: 0, sessions: 0, actors: new Set() });
  }

  for (const row of signups) {
    const point = points.get(key(row.createdAt));
    if (point) point.signups += 1;
  }
  for (const row of sessions) {
    const point = points.get(key(row.createdAt));
    if (point) {
      point.sessions += 1;
      point.actors.add(row.teacherId);
      point.actors.add(row.learnerId);
    }
  }
  for (const row of messages) {
    points.get(key(row.createdAt))?.actors.add(row.senderId);
  }

  return [...points.entries()].map(([date, point]) => ({
    date,
    visits: point.actors.size,
    signups: point.signups,
    sessions: point.sessions,
  }));
};

export interface CategoryDatum {
  label: string;
  value: number;
}

export interface DashboardTraffic {
  timeseries: TimeseriesPoint[];
  topSkills: CategoryDatum[];
  usersByStatus: CategoryDatum[];
}

/** Skills the most people offer to teach — a read on what the platform can supply. */
const getTopSkills = async (limit = 8): Promise<CategoryDatum[]> => {
  const grouped = await prisma.userSkill.groupBy({
    by: ["skillId"],
    _count: { _all: true },
    orderBy: { _count: { skillId: "desc" } },
    take: limit,
  });

  if (grouped.length === 0) return [];

  const skills = await prisma.skill.findMany({
    where: { id: { in: grouped.map((row) => row.skillId) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(skills.map((skill) => [skill.id, skill.name]));

  return grouped
    .map((row) => ({ label: nameById.get(row.skillId) ?? "—", value: row._count._all }))
    .filter((row) => row.label !== "—");
};

const getUsersByStatus = async (): Promise<CategoryDatum[]> => {
  const grouped = await prisma.user.groupBy({
    by: ["status"],
    _count: { _all: true },
  });

  const labels: Record<string, string> = {
    ACTIVE: "Actifs",
    SUSPENDED: "Suspendus",
    DELETED: "Supprimés",
  };

  return grouped.map((row) => ({
    label: labels[row.status] ?? row.status,
    value: row._count._all,
  }));
};

/**
 * The whole traffic payload the dashboard reads.
 *
 * Returned as one object with three named keys because that is the shape the
 * client declares — handing back a bare array made it read `.timeseries` on an
 * array and crash the page before it painted.
 */
export const getDashboardTraffic = async (days: number): Promise<DashboardTraffic> => {
  const [timeseries, topSkills, usersByStatus] = await Promise.all([
    getTimeseries(days),
    getTopSkills(),
    getUsersByStatus(),
  ]);

  return { timeseries, topSkills, usersByStatus };
};
