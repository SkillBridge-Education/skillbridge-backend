import { randomInt } from "crypto";
import { MembershipStatus, OrgRole } from "@prisma/client";
import { prisma } from "../utils/prisma";
import { HttpError } from "../utils/httpError";

/**
 * School join codes and teacher invites.
 *
 * A school code is 6 digits. Its last two digits are the school key, and every
 * teacher invite that school issues ends with those same two digits. Typing a
 * teacher code from the wrong school is therefore caught immediately, before any
 * database lookup.
 *
 * That key is a usability check, not a security boundary — it is printed on the
 * same page as the code it appears to protect. The real secret is the full
 * invite code, which is single-use, expiring, and rate-limited at the route.
 * Six random digits would be brute-forceable on their own, so invites use eight.
 */

const SCHOOL_CODE_DIGITS = 6;
const INVITE_CODE_DIGITS = 8;
const KEY_DIGITS = 2;
const INVITE_LIFETIME_DAYS = 30;

const randomDigits = (count: number): string =>
  Array.from({ length: count }, () => randomInt(0, 10)).join("");

export const schoolKeyOf = (joinCode: string): string => joinCode.slice(-KEY_DIGITS);

/** Generates a code no school is using yet. */
const allocateSchoolCode = async (): Promise<string> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = randomDigits(SCHOOL_CODE_DIGITS);
    const taken = await prisma.organization.findUnique({
      where: { joinCode: code },
      select: { id: true },
    });
    if (!taken) return code;
  }
  // Twenty collisions in a million-wide space means the space is nearly full.
  throw new HttpError(500, "Unable to allocate a school code");
};

/**
 * Issues the join code. Called when an admin approves the school, so a pending
 * application never carries a usable code.
 */
export const assignJoinCode = async (organizationId: string): Promise<string> => {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { joinCode: true },
  });
  if (!organization) throw new HttpError(404, "Organization not found");
  if (organization.joinCode) return organization.joinCode;

  const joinCode = await allocateSchoolCode();
  await prisma.organization.update({ where: { id: organizationId }, data: { joinCode } });
  return joinCode;
};

export const findOrganizationByJoinCode = async (joinCode: string) => {
  const organization = await prisma.organization.findUnique({
    where: { joinCode },
    select: { id: true, name: true, status: true, joinCode: true },
  });

  // Same error whether the code is unknown or the school is inactive: telling
  // them apart would let someone enumerate which codes exist.
  if (!organization || organization.status !== "ACTIVE") {
    throw new HttpError(404, "No active school matches this code");
  }

  return organization;
};

// --- Teacher invites -------------------------------------------------------

/** Only the school creator, or someone they delegated to, may mint invites. */
const requireInviter = async (userId: string) => {
  const membership = await prisma.membership.findFirst({
    where: { userId, status: MembershipStatus.ACTIVE },
    include: { organization: { select: { id: true, status: true, joinCode: true } } },
  });

  if (!membership) throw new HttpError(403, "You do not belong to a school");
  if (membership.organization.status !== "ACTIVE") {
    throw new HttpError(403, "This school account is not active");
  }
  if (membership.orgRole !== OrgRole.ORG_ADMIN && !membership.canInviteTeachers) {
    throw new HttpError(403, "You are not allowed to issue teacher codes");
  }
  if (!membership.organization.joinCode) {
    throw new HttpError(409, "This school has no join code yet");
  }

  return { ...membership.organization, joinCode: membership.organization.joinCode };
};

export const createTeacherInvite = async (userId: string, note?: string) => {
  const organization = await requireInviter(userId);
  const key = schoolKeyOf(organization.joinCode);

  let code = "";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    // Random body with the school key appended: the code carries its own origin.
    const candidate = randomDigits(INVITE_CODE_DIGITS - KEY_DIGITS) + key;
    const taken = await prisma.teacherInvite.findUnique({
      where: { code: candidate },
      select: { id: true },
    });
    if (!taken) {
      code = candidate;
      break;
    }
  }
  if (!code) throw new HttpError(500, "Unable to allocate a teacher code");

  const expiresAt = new Date(Date.now() + INVITE_LIFETIME_DAYS * 24 * 60 * 60 * 1000);

  return prisma.teacherInvite.create({
    data: { code, organizationId: organization.id, createdById: userId, expiresAt, note },
    select: { id: true, code: true, expiresAt: true, note: true, createdAt: true },
  });
};

export const listTeacherInvites = async (userId: string) => {
  const organization = await requireInviter(userId);

  return prisma.teacherInvite.findMany({
    where: { organizationId: organization.id },
    select: {
      id: true,
      code: true,
      note: true,
      expiresAt: true,
      usedAt: true,
      revokedAt: true,
      createdAt: true,
      usedBy: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
};

export const revokeTeacherInvite = async (userId: string, inviteId: string) => {
  const organization = await requireInviter(userId);

  const invite = await prisma.teacherInvite.findUnique({
    where: { id: inviteId },
    select: { organizationId: true, usedAt: true, revokedAt: true },
  });
  if (!invite || invite.organizationId !== organization.id) {
    throw new HttpError(404, "Invite not found");
  }
  if (invite.usedAt) throw new HttpError(400, "This code has already been used");
  if (invite.revokedAt) throw new HttpError(400, "This code is already revoked");

  return prisma.teacherInvite.update({
    where: { id: inviteId },
    data: { revokedAt: new Date() },
    select: { id: true, revokedAt: true },
  });
};

/** Lets the school creator hand the invite power to another member. */
export const setInviteDelegation = async (
  actorId: string,
  targetUserId: string,
  canInvite: boolean
): Promise<void> => {
  const membership = await prisma.membership.findFirst({
    where: { userId: actorId, status: MembershipStatus.ACTIVE, orgRole: OrgRole.ORG_ADMIN },
    select: { organizationId: true },
  });
  if (!membership) throw new HttpError(403, "Only a school administrator can delegate this");

  const { count } = await prisma.membership.updateMany({
    where: {
      userId: targetUserId,
      organizationId: membership.organizationId,
      status: MembershipStatus.ACTIVE,
    },
    data: { canInviteTeachers: canInvite },
  });

  if (count === 0) throw new HttpError(404, "This user is not a member of your school");
};

// --- Joining ---------------------------------------------------------------

/**
 * Joins a school from its code. A student is admitted straight away with no
 * powers; a teacher must also present an invite, which is what separates the
 * two — otherwise anyone holding the school code could claim to teach.
 */
export const joinWithCode = async (input: {
  userId: string;
  joinCode: string;
  teacherCode?: string;
}) => {
  const organization = await findOrganizationByJoinCode(input.joinCode);

  const existing = await prisma.membership.findFirst({
    where: {
      userId: input.userId,
      status: { in: [MembershipStatus.ACTIVE, MembershipStatus.PENDING] },
    },
    select: { organizationId: true },
  });
  if (existing) {
    throw new HttpError(
      409,
      existing.organizationId === organization.id
        ? "You already belong to this school"
        : "You already belong to another school"
    );
  }

  if (!input.teacherCode) {
    return prisma.membership.create({
      data: {
        userId: input.userId,
        organizationId: organization.id,
        orgRole: OrgRole.STUDENT,
        status: MembershipStatus.ACTIVE,
      },
      select: { id: true, orgRole: true, status: true, organizationId: true },
    });
  }

  const teacherCode = input.teacherCode;

  // Cheap check first: a code from another school cannot end with this key.
  if (teacherCode.slice(-KEY_DIGITS) !== schoolKeyOf(organization.joinCode as string)) {
    throw new HttpError(400, "This teacher code does not belong to this school");
  }

  return prisma.$transaction(async (tx) => {
    const invite = await tx.teacherInvite.findUnique({
      where: { code: teacherCode },
      select: { id: true, organizationId: true, usedAt: true, revokedAt: true, expiresAt: true },
    });

    if (!invite || invite.organizationId !== organization.id) {
      throw new HttpError(400, "Invalid teacher code");
    }
    if (invite.revokedAt) throw new HttpError(400, "This teacher code has been revoked");
    if (invite.usedAt) throw new HttpError(400, "This teacher code has already been used");
    if (invite.expiresAt < new Date()) throw new HttpError(400, "This teacher code has expired");

    // Consume the invite conditionally: two people submitting the same code at
    // the same moment must not both become teachers.
    const claimed = await tx.teacherInvite.updateMany({
      where: { id: invite.id, usedAt: null, revokedAt: null },
      data: { usedAt: new Date(), usedById: input.userId },
    });
    if (claimed.count === 0) throw new HttpError(400, "This teacher code has already been used");

    return tx.membership.create({
      data: {
        userId: input.userId,
        organizationId: organization.id,
        orgRole: OrgRole.TEACHER,
        status: MembershipStatus.ACTIVE,
      },
      select: { id: true, orgRole: true, status: true, organizationId: true },
    });
  });
};

/** The code is shown to staff only — a student must never see it. */
export const getJoinCodeForMember = async (userId: string) => {
  const membership = await prisma.membership.findFirst({
    where: { userId, status: MembershipStatus.ACTIVE },
    include: { organization: { select: { name: true, joinCode: true } } },
  });

  if (!membership) throw new HttpError(403, "You do not belong to a school");
  if (membership.orgRole === OrgRole.STUDENT) {
    throw new HttpError(403, "Only staff can see the school code");
  }

  return {
    organizationName: membership.organization.name,
    joinCode: membership.organization.joinCode,
    canInviteTeachers:
      membership.orgRole === OrgRole.ORG_ADMIN || membership.canInviteTeachers,
  };
};
