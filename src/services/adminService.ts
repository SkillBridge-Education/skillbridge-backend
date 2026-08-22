import { Prisma, UserStatus } from "@prisma/client";
import { prisma } from "../utils/prisma";
import { HttpError } from "../utils/httpError";
import { grantCredits, spendCredits } from "./creditService";
import { disconnectUser } from "../sockets";
import { toPage, toPrismaPageArgs } from "../utils/pagination";
import { assignJoinCode } from "./joinCodeService";

/**
 * Every privileged action goes through here so that the audit entry is written
 * in the same transaction as the change itself. A change without its audit
 * entry — or an audit entry without its change — would defeat the point.
 *
 * `reason` is mandatory everywhere: it is what makes the log answer "why",
 * which is the part GDPR accountability actually requires.
 */
const writeAudit = (
  tx: Prisma.TransactionClient,
  input: {
    actorId: string;
    action: string;
    targetType: string;
    targetId: string;
    reason: string;
    metadata?: Prisma.InputJsonValue;
  }
) =>
  tx.adminAuditLog.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.reason,
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    },
  });

const adminUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  status: true,
  credits: true,
  isEmailVerified: true,
  suspendedAt: true,
  suspensionReason: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

// --- Users -----------------------------------------------------------------

export const listUsers = async (params: {
  search?: string;
  status?: UserStatus;
  limit: number;
  cursor?: string;
}) => {
  const where: Prisma.UserWhereInput = {};

  if (params.status) where.status = params.status;
  if (params.search) {
    where.OR = [
      { firstName: { contains: params.search, mode: "insensitive" } },
      { lastName: { contains: params.search, mode: "insensitive" } },
      // Support staff resolve tickets by email, so it has to be searchable here
      // even though it is never exposed on public profiles.
      { email: { contains: params.search, mode: "insensitive" } },
    ];
  }

  const rows = await prisma.user.findMany({
    where,
    select: adminUserSelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...toPrismaPageArgs(params),
  });

  return toPage(rows, params.limit);
};

export const getUserForAdmin = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      ...adminUserSelect,
      memberships: { include: { organization: { select: { id: true, name: true } } } },
      _count: { select: { reportsReceived: true, reportsMade: true } },
    },
  });

  if (!user) throw new HttpError(404, "User not found");
  return user;
};

export const banUser = async (actorId: string, userId: string, reason: string) => {
  if (actorId === userId) {
    throw new HttpError(400, "You cannot suspend your own account");
  }

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { status: true, role: true },
  });
  if (!target) throw new HttpError(404, "User not found");
  if (target.status === UserStatus.SUSPENDED) {
    throw new HttpError(400, "User is already suspended");
  }

  const user = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: userId },
      data: {
        status: UserStatus.SUSPENDED,
        suspendedAt: new Date(),
        suspensionReason: reason,
      },
      select: adminUserSelect,
    });

    await writeAudit(tx, {
      actorId,
      action: "USER_BANNED",
      targetType: "User",
      targetId: userId,
      reason,
    });

    return updated;
  });

  // The HTTP middleware re-reads status on every request, so the API is already
  // closed to them; open sockets survive the change and must be cut explicitly.
  disconnectUser(userId, "Your account has been suspended");

  return user;
};

export const unbanUser = async (actorId: string, userId: string, reason: string) => {
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { status: true },
  });
  if (!target) throw new HttpError(404, "User not found");
  if (target.status !== UserStatus.SUSPENDED) {
    throw new HttpError(400, "User is not suspended");
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: userId },
      data: { status: UserStatus.ACTIVE, suspendedAt: null, suspensionReason: null },
      select: adminUserSelect,
    });

    await writeAudit(tx, {
      actorId,
      action: "USER_UNBANNED",
      targetType: "User",
      targetId: userId,
      reason,
    });

    return updated;
  });
};

/**
 * Credits are adjusted by a signed delta rather than an absolute balance: an
 * absolute value silently overwrites whatever happened between the moment the
 * admin loaded the page and the moment they submitted.
 */
export const adjustCredits = async (
  actorId: string,
  userId: string,
  amount: number,
  reason: string
) => {
  if (amount === 0) throw new HttpError(400, "Amount must not be zero");

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!target) throw new HttpError(404, "User not found");

  return prisma.$transaction(async (tx) => {
    // Goes through the capped helpers so an adjustment cannot break the
    // User_credits_bounds_check constraint.
    if (amount > 0) {
      await grantCredits(tx, userId, amount);
    } else {
      await spendCredits(tx, userId, Math.abs(amount));
    }

    const transaction = await tx.rewardTransaction.create({
      data: {
        userId,
        adminId: actorId,
        amount,
        type: "ADJUSTED",
        description: reason,
      },
    });

    await writeAudit(tx, {
      actorId,
      action: "CREDITS_ADJUSTED",
      targetType: "User",
      targetId: userId,
      reason,
      metadata: { amount },
    });

    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: adminUserSelect,
    });

    return { user, transaction };
  });
};

// --- Reports ---------------------------------------------------------------

export const listReports = async (params: {
  status?: "PENDING" | "REVIEWING" | "ACTIONED" | "DISMISSED";
  limit: number;
  cursor?: string;
}) => {
  const rows = await prisma.report.findMany({
    where: params.status ? { status: params.status } : {},
    include: {
      reporter: { select: { id: true, firstName: true, lastName: true } },
      reportedUser: { select: { id: true, firstName: true, lastName: true, status: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...toPrismaPageArgs(params),
  });

  return toPage(rows, params.limit);
};

const resolveReport = (action: "ACTIONED" | "DISMISSED") =>
  async (actorId: string, reportId: string, reason: string) => {
    const report = await prisma.report.findUnique({
      where: { id: reportId },
      select: { status: true },
    });
    if (!report) throw new HttpError(404, "Report not found");
    if (report.status === "ACTIONED" || report.status === "DISMISSED") {
      throw new HttpError(400, "Report has already been reviewed");
    }

    return prisma.$transaction(async (tx) => {
      const updated = await tx.report.update({
        where: { id: reportId },
        data: {
          status: action,
          reviewedById: actorId,
          reviewedAt: new Date(),
          resolution: reason,
        },
      });

      await writeAudit(tx, {
        actorId,
        action: action === "ACTIONED" ? "REPORT_ACTIONED" : "REPORT_DISMISSED",
        targetType: "Report",
        targetId: reportId,
        reason,
      });

      return updated;
    });
  };

export const actionReport = resolveReport("ACTIONED");
export const dismissReport = resolveReport("DISMISSED");

// --- Organizations ---------------------------------------------------------

export const listOrganizations = async (params: {
  status?: "PENDING" | "ACTIVE" | "REJECTED" | "SUSPENDED";
  limit: number;
  cursor?: string;
}) => {
  const rows = await prisma.organization.findMany({
    where: params.status ? { status: params.status } : {},
    include: { _count: { select: { memberships: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...toPrismaPageArgs(params),
  });

  return toPage(rows, params.limit);
};

const reviewOrganization = (status: "ACTIVE" | "REJECTED") =>
  async (actorId: string, organizationId: string, reason: string) => {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { status: true },
    });
    if (!organization) throw new HttpError(404, "Organization not found");
    if (organization.status !== "PENDING") {
      throw new HttpError(400, "Organization has already been reviewed");
    }

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.organization.update({
        where: { id: organizationId },
        data: {
          status,
          reviewedById: actorId,
          reviewedAt: new Date(),
          reviewNote: reason,
        },
      });

      await writeAudit(tx, {
        actorId,
        action: status === "ACTIVE" ? "ORGANIZATION_APPROVED" : "ORGANIZATION_REJECTED",
        targetType: "Organization",
        targetId: organizationId,
        reason,
      });

      return updated;
    });

    // Issued only on approval, so a pending application never carries a usable
    // code. Outside the transaction: allocating it retries on collision, which
    // would hold the row lock for as long as that takes.
    if (status === "ACTIVE") {
      await assignJoinCode(organizationId);
    }

    return result;
  };

// Manual approval is what keeps school mode out of reach of individual sign-ups.
export const approveOrganization = reviewOrganization("ACTIVE");
export const rejectOrganization = reviewOrganization("REJECTED");

// --- Appeals ---------------------------------------------------------------

export const listAppeals = async (params: {
  status?: "PENDING" | "GRANTED" | "DENIED";
  limit: number;
  cursor?: string;
}) => {
  const rows = await prisma.appeal.findMany({
    where: params.status ? { status: params.status } : {},
    include: {
      user: { select: { id: true, firstName: true, lastName: true, status: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...toPrismaPageArgs(params),
  });

  return toPage(rows, params.limit);
};

/**
 * Granting an appeal lifts the suspension in the same transaction, so the two
 * can never drift apart.
 */
export const reviewAppeal = async (
  actorId: string,
  appealId: string,
  decision: "GRANTED" | "DENIED",
  response: string
) => {
  const appeal = await prisma.appeal.findUnique({
    where: { id: appealId },
    select: { status: true, userId: true },
  });
  if (!appeal) throw new HttpError(404, "Appeal not found");
  if (appeal.status !== "PENDING") {
    throw new HttpError(400, "Appeal has already been reviewed");
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.appeal.update({
      where: { id: appealId },
      data: {
        status: decision,
        reviewedById: actorId,
        reviewedAt: new Date(),
        adminResponse: response,
      },
    });

    if (decision === "GRANTED") {
      await tx.user.update({
        where: { id: appeal.userId },
        data: { status: UserStatus.ACTIVE, suspendedAt: null, suspensionReason: null },
      });
    }

    await writeAudit(tx, {
      actorId,
      action: decision === "GRANTED" ? "APPEAL_GRANTED" : "APPEAL_DENIED",
      targetType: "Appeal",
      targetId: appealId,
      reason: response,
    });

    return updated;
  });
};

// --- Audit trail -----------------------------------------------------------

// Read only by design: there is no service function that edits or deletes an
// audit entry, because a trail that can be rewritten proves nothing.
export const listAuditLog = async (params: {
  action?: string;
  actorId?: string;
  limit: number;
  cursor?: string;
}) => {
  const where: Prisma.AdminAuditLogWhereInput = {};
  if (params.action) where.action = params.action;
  if (params.actorId) where.actorId = params.actorId;

  const rows = await prisma.adminAuditLog.findMany({
    where,
    include: { actor: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...toPrismaPageArgs(params),
  });

  return toPage(rows, params.limit);
};

// --- Dashboard stats -------------------------------------------------------

export const getPlatformStats = async () => {
  const [totalUsers, activeUsers, suspendedUsers, pendingReports, pendingOrganizations, pendingAppeals, sessions] =
    await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { status: UserStatus.ACTIVE } }),
      prisma.user.count({ where: { status: UserStatus.SUSPENDED } }),
      prisma.report.count({ where: { status: "PENDING" } }),
      prisma.organization.count({ where: { status: "PENDING" } }),
      prisma.appeal.count({ where: { status: "PENDING" } }),
      prisma.teachingSession.count(),
    ]);

  return {
    users: { total: totalUsers, active: activeUsers, suspended: suspendedUsers },
    queues: {
      reports: pendingReports,
      organizations: pendingOrganizations,
      appeals: pendingAppeals,
    },
    sessions: { total: sessions },
  };
};

/**
 * Records a settings change in the audit trail.
 *
 * Kept apart from updateSettings so the audit entry names *what* changed rather
 * than only that something did: reading "SETTINGS_UPDATED" with no detail six
 * months later answers nothing.
 */
export const recordSettingsChange = async (
  actorId: string,
  reason: string,
  patch: Record<string, unknown>
): Promise<void> => {
  await prisma.adminAuditLog.create({
    data: {
      actorId,
      action: "SETTINGS_UPDATED",
      targetType: "Platform",
      targetId: "platform",
      reason,
      metadata: patch as Prisma.InputJsonValue,
    },
  });
};
