import { Prisma, ReportReason, UserStatus } from "@prisma/client";
import { prisma } from "../utils/prisma";
import { HttpError } from "../utils/httpError";
import { disconnectUser } from "../sockets";
import { logger } from "../utils/logger";

/**
 * How many *distinct* reporters it takes before an account is restricted
 * automatically. Counting distinct reporters rather than reports is the whole
 * point: otherwise one account could file three reports and silence anyone.
 */
export const AUTO_SUSPEND_THRESHOLD = 3;

export const createReport = async (input: {
  reporterId: string;
  reportedUserId: string;
  reason: ReportReason;
  description?: string;
  messageId?: string;
}) => {
  if (input.reporterId === input.reportedUserId) {
    throw new HttpError(400, "You cannot report yourself");
  }

  const reported = await prisma.user.findUnique({
    where: { id: input.reportedUserId },
    select: { id: true, status: true },
  });
  if (!reported) throw new HttpError(404, "User not found");

  // One open report per pair: re-reporting the same person while a decision is
  // pending adds noise to the queue without adding information, and would let a
  // single account inflate the auto-suspension count on its own.
  const existing = await prisma.report.findFirst({
    where: {
      reporterId: input.reporterId,
      reportedUserId: input.reportedUserId,
      status: { in: ["PENDING", "REVIEWING"] },
    },
    select: { id: true },
  });
  if (existing) {
    throw new HttpError(409, "You already have a pending report against this user");
  }

  const report = await prisma.report.create({
    data: {
      reporterId: input.reporterId,
      reportedUserId: input.reportedUserId,
      reason: input.reason,
      description: input.description,
      messageId: input.messageId,
    },
  });

  await applyAutoSuspension(input.reportedUserId);

  return report;
};

/**
 * Suspends an account once enough *distinct* people have reported it and a
 * moderator has not yet ruled. This is a holding measure, not a verdict: the
 * account keeps its route of appeal, and a human still reviews the queue.
 */
const applyAutoSuspension = async (reportedUserId: string): Promise<void> => {
  const distinctReporters = await prisma.report.findMany({
    where: { reportedUserId, status: { in: ["PENDING", "REVIEWING"] } },
    distinct: ["reporterId"],
    select: { reporterId: true },
  });

  if (distinctReporters.length < AUTO_SUSPEND_THRESHOLD) return;

  const user = await prisma.user.findUnique({
    where: { id: reportedUserId },
    select: { status: true, role: true },
  });

  // Never auto-suspend staff: a coordinated report campaign must not be able to
  // lock the people who would review it out of the platform.
  if (!user || user.status !== UserStatus.ACTIVE || user.role === "ADMIN") return;

  await prisma.user.update({
    where: { id: reportedUserId },
    data: {
      status: UserStatus.SUSPENDED,
      suspendedAt: new Date(),
      suspensionReason:
        "Automatically restricted after multiple reports, pending review by our team.",
    },
  });

  disconnectUser(reportedUserId, "Your account has been restricted pending review");

  logger.warn(
    { userId: reportedUserId, reporters: distinctReporters.length },
    "Account auto-suspended after reaching the distinct-reporter threshold"
  );
};

export const listMyReports = async (reporterId: string) =>
  prisma.report.findMany({
    where: { reporterId },
    select: { id: true, reportedUserId: true, reason: true, status: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

// --- User-to-user blocking -------------------------------------------------

/** A personal preference, unrelated to moderation: no sanction, no review. */
export const blockUser = async (blockerId: string, blockedId: string) => {
  if (blockerId === blockedId) {
    throw new HttpError(400, "You cannot block yourself");
  }

  const target = await prisma.user.findUnique({
    where: { id: blockedId },
    select: { id: true },
  });
  if (!target) throw new HttpError(404, "User not found");

  try {
    return await prisma.userBlock.create({ data: { blockerId, blockedId } });
  } catch (error) {
    // Blocking twice is not an error from the user's point of view.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return prisma.userBlock.findFirstOrThrow({ where: { blockerId, blockedId } });
    }
    throw error;
  }
};

export const unblockUser = async (blockerId: string, blockedId: string) => {
  const { count } = await prisma.userBlock.deleteMany({ where: { blockerId, blockedId } });
  if (count === 0) throw new HttpError(404, "This user is not blocked");
};

export const listBlockedUsers = async (blockerId: string) =>
  prisma.userBlock.findMany({
    where: { blockerId },
    include: {
      blocked: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
    },
    orderBy: { createdAt: "desc" },
  });

// --- Appeals ---------------------------------------------------------------

/**
 * The only action a suspended account may still take. Under the DSA a sanction
 * has to come with an internal route of appeal, so this deliberately accepts
 * callers that `authenticate` would reject.
 */
export const createAppeal = async (userId: string, message: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { status: true },
  });
  if (!user) throw new HttpError(404, "User not found");
  if (user.status !== UserStatus.SUSPENDED) {
    throw new HttpError(400, "Only a suspended account can submit an appeal");
  }

  const pending = await prisma.appeal.findFirst({
    where: { userId, status: "PENDING" },
    select: { id: true },
  });
  if (pending) {
    throw new HttpError(409, "You already have an appeal awaiting review");
  }

  return prisma.appeal.create({ data: { userId, message } });
};

export const listMyAppeals = async (userId: string) =>
  prisma.appeal.findMany({
    where: { userId },
    select: {
      id: true,
      message: true,
      status: true,
      adminResponse: true,
      createdAt: true,
      reviewedAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

// --- School registration requests ------------------------------------------

const slugify = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

/**
 * Anyone may *request* a school account; only a platform admin can approve it.
 * That review is what keeps school mode out of reach of individual sign-ups.
 */
export const requestOrganization = async (input: {
  name: string;
  contactName: string;
  contactEmail: string;
  emailDomain?: string;
}) => {
  const baseSlug = slugify(input.name);
  if (!baseSlug) throw new HttpError(400, "Organization name is invalid");

  const existing = await prisma.organization.findFirst({
    where: { name: { equals: input.name, mode: "insensitive" } },
    select: { status: true },
  });
  if (existing) {
    throw new HttpError(409, "A request already exists for this organization");
  }

  // Slugs are unique; suffix on collision rather than failing the request.
  let slug = baseSlug;
  for (let attempt = 2; await prisma.organization.findUnique({ where: { slug } }); attempt += 1) {
    slug = `${baseSlug}-${attempt}`;
  }

  return prisma.organization.create({
    data: {
      name: input.name,
      slug,
      contactName: input.contactName,
      contactEmail: input.contactEmail,
      emailDomain: input.emailDomain,
      // Explicit: a request is never active on creation.
      status: "PENDING",
    },
    select: { id: true, name: true, slug: true, status: true, createdAt: true },
  });
};
