import { Role, UserStatus } from "@prisma/client";
import { prisma } from "../utils/prisma";
import { HttpError } from "../utils/httpError";
import { comparePassword } from "../utils/password";
import { generateToken } from "../utils/jwt";
import { logger } from "../utils/logger";

/**
 * Sign-in for the back-office.
 *
 * Separate from the public login on purpose: this surface can suspend accounts
 * and hand out credits, so it refuses non-admins outright rather than letting
 * them in and hiding the buttons.
 *
 * The dashboard expects a two-step flow ending in a TOTP challenge. That second
 * factor is NOT implemented — there is no secret stored, nothing to verify
 * against. Rather than accept any six digits and call it multi-factor, this
 * returns AUTHENTICATED directly and reports mfaEnabled: false, so the client
 * can say plainly that the second factor is not set up yet.
 */

export const adminLogin = async (email: string, password: string) => {
  const normalized = email.trim().toLowerCase();

  const user = await prisma.user.findUnique({
    where: { email: normalized },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      status: true,
      passwordHash: true,
      avatarUrl: true,
    },
  });

  // Same message whether the account is unknown, not an admin, or the password
  // is wrong: distinguishing them would let anyone enumerate who is staff.
  const invalid = new HttpError(401, "Invalid credentials");

  if (!user) throw invalid;

  const passwordValid = await comparePassword(password, user.passwordHash);
  if (!passwordValid) throw invalid;

  if (user.role !== Role.ADMIN || user.status !== UserStatus.ACTIVE) {
    // Logged, because a correct password on a non-admin account is worth
    // noticing — it is either a mistake or someone probing.
    logger.warn({ userId: user.id }, "Non-admin attempted to sign in to the back-office");
    throw invalid;
  }

  const token = generateToken({ userId: user.id, role: user.role });

  return {
    status: "AUTHENTICATED" as const,
    // Stated rather than implied: the dashboard shows a second-factor step, and
    // this is what tells it the step is not real yet.
    mfaEnabled: false,
    token,
    admin: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      avatarUrl: user.avatarUrl,
    },
  };
};

export const getAdminProfile = async (userId: string) => {
  const admin = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, firstName: true, lastName: true, avatarUrl: true, role: true },
  });

  if (!admin || admin.role !== Role.ADMIN) {
    throw new HttpError(403, "You do not have permission to access this resource");
  }

  return admin;
};

/**
 * Traffic over the last N days, one bucket per day.
 *
 * Counts what the platform actually records — sign-ups, sessions, messages.
 * There is no page-view or visit tracking, and inventing one would misreport
 * it; these are the real signals of a day's activity.
 */
export const getTraffic = async (days: number) => {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - (days - 1));

  const [signups, sessions, messages] = await Promise.all([
    prisma.user.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true },
    }),
    prisma.teachingSession.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true },
    }),
    prisma.message.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true },
    }),
  ]);

  const dayKey = (date: Date): string => date.toISOString().slice(0, 10);

  // Every day in the window is present, including empty ones: a chart that
  // silently skips quiet days flatters the numbers.
  const buckets = new Map<string, { date: string; signups: number; sessions: number; messages: number }>();
  for (let offset = 0; offset < days; offset += 1) {
    const date = new Date(since);
    date.setDate(date.getDate() + offset);
    buckets.set(dayKey(date), { date: dayKey(date), signups: 0, sessions: 0, messages: 0 });
  }

  const bump = (rows: Array<{ createdAt: Date }>, field: "signups" | "sessions" | "messages") => {
    for (const row of rows) {
      const bucket = buckets.get(dayKey(row.createdAt));
      if (bucket) bucket[field] += 1;
    }
  };

  bump(signups, "signups");
  bump(sessions, "sessions");
  bump(messages, "messages");

  return [...buckets.values()];
};
