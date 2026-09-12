import { MembershipStatus, OrgRole, Prisma } from "@prisma/client";
import { prisma } from "../utils/prisma";
import { HttpError } from "../utils/httpError";

/**
 * School membership. The rule that governs this whole file: a member's authority
 * is scoped to their own organization. A TEACHER is not privileged on the
 * platform — they are privileged inside one school — so every read below is
 * filtered by the caller's organizationId, never by their role alone.
 */

/** The caller's active membership, or null for an individual account. */
/**
 * The caller's membership and what it currently entitles them to.
 *
 * `mode` is deliberately derived here rather than from the row alone. A member
 * of a suspended school used to be told SCHOOL while every school route refused
 * them — and, worse, their credits kept being charged behind a tab the client
 * had hidden. The rule that governs the powers has to be the rule that governs
 * what the client is told.
 *
 * PENDING is reported too: someone who asked to join and heard nothing back has
 * no way to tell a slow admin from a lost request.
 */
export const getMembershipState = async (userId: string) => {
  const membership = await prisma.membership.findFirst({
    where: {
      userId,
      status: { in: [MembershipStatus.ACTIVE, MembershipStatus.PENDING, MembershipStatus.ALUMNI] },
    },
    include: {
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          // L'identite voyage avec l'adhesion : c'est la seule reponse que
          // chaque client lit deja au demarrage, donc le seul endroit ou la
          // poser sans ajouter un appel sur le chemin critique.
          logoUrl: true,
          bannerUrl: true,
          brandColor: true,
        },
      },
    },
    // ACTIVE first, so a stale ALUMNI row never masks a current membership.
    orderBy: { createdAt: "desc" },
  });

  if (!membership) return { membership: null, mode: "INDIVIDUAL" as const };

  const schoolActive = membership.organization.status === "ACTIVE";
  const isMember = membership.status === MembershipStatus.ACTIVE;

  return {
    membership,
    // Only an active membership in an active school gets the school experience,
    // which is exactly the condition every other route enforces.
    mode: schoolActive && isMember ? ("SCHOOL" as const) : ("INDIVIDUAL" as const),
    schoolActive,
    pending: membership.status === MembershipStatus.PENDING,
    alumni: membership.status === MembershipStatus.ALUMNI,
  };
};

/** Active membership only — what the school features are keyed on. */
export const getActiveMembership = async (userId: string) =>
  prisma.membership.findFirst({
    where: { userId, status: MembershipStatus.ACTIVE },
    include: {
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          // L'identite voyage avec l'adhesion : c'est la seule reponse que
          // chaque client lit deja au demarrage, donc le seul endroit ou la
          // poser sans ajouter un appel sur le chemin critique.
          logoUrl: true,
          bannerUrl: true,
          brandColor: true,
        },
      },
    },
  });

/**
 * Resolves the membership a caller must hold to act inside a school, refusing
 * anyone whose organization is not approved. Suspending a school therefore
 * suspends its staff powers without touching individual accounts.
 */
const requireMembership = async (
  userId: string,
  roles: OrgRole[]
): Promise<{ organizationId: string; orgRole: OrgRole }> => {
  const membership = await getActiveMembership(userId);

  if (!membership) {
    throw new HttpError(403, "This feature is only available to school members");
  }
  if (membership.organization.status !== "ACTIVE") {
    throw new HttpError(403, "This school account is not active");
  }
  if (!roles.includes(membership.orgRole)) {
    throw new HttpError(403, "You do not have permission to access this resource");
  }

  return { organizationId: membership.organizationId, orgRole: membership.orgRole };
};

/**
 * Every role that administers a school.
 *
 * ORG_SUPER_ADMIN is the account that registered the institution, so leaving it
 * out of these lists would lock the founder out of their own structure — the one
 * person who must never lose access.
 */
const ADMIN_ROLES: OrgRole[] = [OrgRole.ORG_ADMIN, OrgRole.ORG_SUPER_ADMIN];

export const requireTeacher = (userId: string) =>
  requireMembership(userId, [OrgRole.TEACHER, ...ADMIN_ROLES]);

export const requireOrgAdmin = (userId: string) => requireMembership(userId, ADMIN_ROLES);

/**
 * Powers that stay with the founder: appointing administrators, and changing who
 * the founder is. Delegating these would make the distinction meaningless.
 */
export const requireOrgSuperAdmin = (userId: string) =>
  requireMembership(userId, [OrgRole.ORG_SUPER_ADMIN]);

// --- Joining a school (sign-up flow) ---------------------------------------

/**
 * Approved schools a new user can pick from at sign-up. Public on purpose —
 * someone has to choose their school before they belong to it — so it exposes
 * only what a picker needs, never contact details or member counts.
 */
export const listJoinableOrganizations = async (search?: string) =>
  prisma.organization.findMany({
    where: {
      status: "ACTIVE",
      ...(search ? { name: { contains: search, mode: "insensitive" } } : {}),
    },
    select: { id: true, name: true, slug: true },
    orderBy: { name: "asc" },
    take: 50,
  });

/**
 * Requests to join a school. Creates a PENDING membership, which grants
 * nothing: only a school admin moving it to ACTIVE turns the account into a
 * school account. Self-service would defeat that review entirely.
 */
export const requestToJoin = async (userId: string, organizationId: string) => {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { status: true },
  });
  if (!organization || organization.status !== "ACTIVE") {
    throw new HttpError(404, "School not found");
  }

  const existing = await prisma.membership.findFirst({
    where: { userId, status: { in: [MembershipStatus.ACTIVE, MembershipStatus.PENDING] } },
    select: { organizationId: true, status: true },
  });

  if (existing) {
    if (existing.organizationId === organizationId) {
      throw new HttpError(
        409,
        existing.status === MembershipStatus.ACTIVE
          ? "You already belong to this school"
          : "Your request is already awaiting review"
      );
    }
    throw new HttpError(409, "You already belong to another school");
  }

  return prisma.membership.upsert({
    where: { userId_organizationId: { userId, organizationId } },
    update: { status: MembershipStatus.PENDING, orgRole: OrgRole.STUDENT },
    create: { userId, organizationId, orgRole: OrgRole.STUDENT, status: MembershipStatus.PENDING },
    select: { id: true, organizationId: true, orgRole: true, status: true, createdAt: true },
  });
};

/** Pending join requests for the caller's school. */
export const listJoinRequests = async (actorId: string) => {
  const { organizationId } = await requireOrgAdmin(actorId);

  return prisma.membership.findMany({
    where: { organizationId, status: MembershipStatus.PENDING },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
    },
    orderBy: { createdAt: "asc" },
  });
};

export const reviewJoinRequest = async (
  actorId: string,
  membershipId: string,
  decision: "APPROVE" | "REJECT",
  orgRole: OrgRole = OrgRole.STUDENT
) => {
  const { organizationId } = await requireOrgAdmin(actorId);

  const membership = await prisma.membership.findUnique({
    where: { id: membershipId },
    select: { organizationId: true, status: true },
  });
  if (!membership || membership.organizationId !== organizationId) {
    throw new HttpError(404, "Request not found");
  }
  if (membership.status !== MembershipStatus.PENDING) {
    throw new HttpError(400, "This request has already been reviewed");
  }

  return prisma.membership.update({
    where: { id: membershipId },
    data:
      decision === "APPROVE"
        ? { status: MembershipStatus.ACTIVE, orgRole }
        : { status: MembershipStatus.REVOKED },
  });
};

// --- Membership management (school admins) ---------------------------------

export const listMembers = async (
  actorId: string,
  params: { orgRole?: OrgRole; limit: number }
) => {
  const { organizationId } = await requireMembership(actorId, [
    OrgRole.TEACHER,
    ...ADMIN_ROLES,
  ]);

  return prisma.membership.findMany({
    where: {
      organizationId,
      status: MembershipStatus.ACTIVE,
      ...(params.orgRole ? { orgRole: params.orgRole } : {}),
    },
    include: {
      user: {
        select: { id: true, firstName: true, lastName: true, avatarUrl: true, averageRating: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: params.limit,
  });
};

/**
 * Adds a member to the caller's own school. The organization is taken from the
 * caller's membership rather than the request body: accepting it from the client
 * would let a school admin enrol users into someone else's school.
 */
export const addMember = async (
  actorId: string,
  userId: string,
  orgRole: OrgRole
) => {
  const { organizationId } = await requireOrgAdmin(actorId);

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw new HttpError(404, "User not found");

  const existing = await prisma.membership.findFirst({
    where: { userId, status: MembershipStatus.ACTIVE },
    select: { organizationId: true },
  });
  if (existing && existing.organizationId !== organizationId) {
    throw new HttpError(409, "This user already belongs to another school");
  }

  try {
    return await prisma.membership.upsert({
      where: { userId_organizationId: { userId, organizationId } },
      update: { orgRole, status: MembershipStatus.ACTIVE },
      create: { userId, organizationId, orgRole },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new HttpError(409, "This user is already a member");
    }
    throw error;
  }
};

/**
 * Removes someone from the school.
 *
 * `graduated` decides which of two very different things this is. Someone who
 * finished becomes an ALUMNI: they keep a place in the network and stay
 * reachable, which is the point of school mode. Someone excluded is REVOKED and
 * loses access. Collapsing the two would either strand former students or leave
 * excluded ones visible.
 *
 * Neither deletes the account: the person keeps it, and it becomes an ordinary
 * individual account.
 */
export const removeMember = async (
  actorId: string,
  userId: string,
  graduated = false
) => {
  const { organizationId } = await requireOrgAdmin(actorId);

  if (actorId === userId) {
    throw new HttpError(400, "You cannot remove yourself from the school");
  }

  const { count } = await prisma.membership.updateMany({
    where: { userId, organizationId, status: MembershipStatus.ACTIVE },
    data: {
      status: graduated ? MembershipStatus.ALUMNI : MembershipStatus.REVOKED,
      leftAt: new Date(),
    },
  });

  if (count === 0) throw new HttpError(404, "This user is not a member of your school");
};

/**
 * Leaving of one's own accord. Always produces an alumnus — someone who chose
 * to go has not been excluded, and the distinction is the whole reason the two
 * states exist.
 */
export const leaveOrganization = async (userId: string) => {
  const membership = await getActiveMembership(userId);
  if (!membership) throw new HttpError(404, "You do not belong to a school");

  await prisma.membership.update({
    where: { id: membership.id },
    data: { status: MembershipStatus.ALUMNI, leftAt: new Date() },
  });
};

/**
 * The school directory, open to every member rather than staff only.
 *
 * This is what makes school mode worth having: a student looks for classmates
 * and for former students who might open a door. Restricting it to staff — as
 * the previous version did — left the network invisible to the people it exists
 * for.
 *
 * Alumni are included and flagged, never hidden: a network that drops people
 * the day they graduate is not a network.
 */
export const browseSchoolDirectory = async (
  actorId: string,
  params: { search?: string; orgRole?: OrgRole; includeAlumni?: boolean; limit: number }
) => {
  const membership = await getActiveMembership(actorId);
  if (!membership) throw new HttpError(403, "This feature is only available to school members");
  if (membership.organization.status !== "ACTIVE") {
    throw new HttpError(403, "This school account is not active");
  }

  const statuses = params.includeAlumni
    ? [MembershipStatus.ACTIVE, MembershipStatus.ALUMNI]
    : [MembershipStatus.ACTIVE];

  const rows = await prisma.membership.findMany({
    where: {
      organizationId: membership.organizationId,
      status: { in: statuses },
      ...(params.orgRole ? { orgRole: params.orgRole } : {}),
      ...(params.search
        ? {
            user: {
              OR: [
                { firstName: { contains: params.search, mode: "insensitive" } },
                { lastName: { contains: params.search, mode: "insensitive" } },
              ],
            },
          }
        : {}),
      // A member's own row is not a search result.
      NOT: { userId: actorId },
      user: { status: "ACTIVE" },
    },
    select: {
      id: true,
      orgRole: true,
      status: true,
      studyLevel: true,
      leftAt: true,
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          avatarUrl: true,
          bio: true,
          averageRating: true,
          totalRatings: true,
          teachingSkills: {
            select: { skill: { select: { id: true, name: true, category: true } } },
            take: 5,
          },
        },
      },
    },
    // Current members before alumni, then most recent.
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: params.limit,
  });

  return rows.map((row) => ({
    ...row,
    isAlumni: row.status === MembershipStatus.ALUMNI,
  }));
};

/** The levels this school awards, for the picker shown at join time. */
export const getStudyLevels = async (organizationId: string): Promise<string[]> => {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { studyLevels: true },
  });

  if (!organization?.studyLevels) return [];

  try {
    const parsed: unknown = JSON.parse(organization.studyLevels);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    // Stored malformed: an empty picker is better than a crash on a join screen.
    return [];
  }
};

/** Replaces the list of levels. Admin only — it drives what members can pick. */
export const setStudyLevels = async (actorId: string, levels: string[]) => {
  const { organizationId } = await requireOrgAdmin(actorId);

  const cleaned = levels
    .map((level) => level.trim())
    .filter(Boolean)
    .slice(0, 30);

  await prisma.organization.update({
    where: { id: organizationId },
    data: { studyLevels: JSON.stringify(cleaned) },
  });

  return cleaned;
};

/** A member sets their own level, from what the school offers. */
export const setMyStudyLevel = async (userId: string, studyLevel: string | null) => {
  const membership = await getActiveMembership(userId);
  if (!membership) throw new HttpError(403, "You do not belong to a school");

  if (studyLevel !== null) {
    const allowed = await getStudyLevels(membership.organizationId);
    // An empty list means the school has not configured any, so anything is
    // refused rather than silently accepted.
    if (!allowed.includes(studyLevel)) {
      throw new HttpError(400, "This study level is not offered by your school");
    }
  }

  return prisma.membership.update({
    where: { id: membership.id },
    data: { studyLevel },
    select: { id: true, studyLevel: true },
  });
};

// --- Teacher dashboard -----------------------------------------------------

/** Ids of the students in the caller's school, used to scope every query below. */
const studentIdsOf = async (organizationId: string): Promise<string[]> => {
  const rows = await prisma.membership.findMany({
    where: { organizationId, status: MembershipStatus.ACTIVE, orgRole: OrgRole.STUDENT },
    select: { userId: true },
  });
  return rows.map((row) => row.userId);
};

/** Sessions where the caller is the teacher. Filterable by status. */
export const getTeacherAgenda = async (
  userId: string,
  params: { status?: string; limit: number }
) => {
  await requireTeacher(userId);

  return prisma.teachingSession.findMany({
    where: {
      teacherId: userId,
      ...(params.status ? { status: params.status as never } : {}),
    },
    include: {
      learner: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
    },
    orderBy: { startsAt: "asc" },
    take: params.limit,
  });
};

/**
 * Per-student progress across the school. Scoped to the caller's own
 * organization: a teacher must never see students from another school.
 */
export const getStudentProgress = async (userId: string) => {
  const { organizationId } = await requireTeacher(userId);
  const studentIds = await studentIdsOf(organizationId);

  if (studentIds.length === 0) return [];

  const [sessions, students] = await Promise.all([
    prisma.teachingSession.groupBy({
      by: ["learnerId"],
      where: { learnerId: { in: studentIds }, status: "COMPLETED" },
      _count: { _all: true },
      _sum: { creditsConsumed: true },
      _max: { actualEndedAt: true },
    }),
    prisma.user.findMany({
      where: { id: { in: studentIds } },
      select: { id: true, firstName: true, lastName: true, avatarUrl: true },
    }),
  ]);

  const byLearner = new Map(sessions.map((row) => [row.learnerId, row]));

  return students.map((student) => {
    const stats = byLearner.get(student.id);
    return {
      student,
      completedSessions: stats?._count._all ?? 0,
      minutesLearned: stats?._sum.creditsConsumed ?? 0,
      lastSessionAt: stats?._max.actualEndedAt ?? null,
    };
  });
};

/**
 * Students who look disengaged: repeated no-shows or cancellations, or no
 * completed session at all. Deliberately a signal for a human to look at, not
 * an automated judgement.
 */
export const getStudentsAtRisk = async (userId: string) => {
  const { organizationId } = await requireTeacher(userId);
  const studentIds = await studentIdsOf(organizationId);

  if (studentIds.length === 0) return [];

  const [missed, completed, students] = await Promise.all([
    prisma.teachingSession.groupBy({
      by: ["learnerId"],
      where: { learnerId: { in: studentIds }, status: { in: ["NO_SHOW", "CANCELLED"] } },
      _count: { _all: true },
    }),
    prisma.teachingSession.groupBy({
      by: ["learnerId"],
      where: { learnerId: { in: studentIds }, status: "COMPLETED" },
      _count: { _all: true },
    }),
    prisma.user.findMany({
      where: { id: { in: studentIds } },
      select: { id: true, firstName: true, lastName: true, avatarUrl: true },
    }),
  ]);

  const missedBy = new Map(missed.map((row) => [row.learnerId, row._count._all]));
  const completedBy = new Map(completed.map((row) => [row.learnerId, row._count._all]));

  return students
    .map((student) => ({
      student,
      missedSessions: missedBy.get(student.id) ?? 0,
      completedSessions: completedBy.get(student.id) ?? 0,
    }))
    .filter((row) => row.missedSessions >= 2 || row.completedSessions === 0)
    .sort((a, b) => b.missedSessions - a.missedSessions);
};

/**
 * Learning goals in the school that no member can currently teach — the gaps a
 * teacher is best placed to fill.
 */
export const getClassSkillGaps = async (userId: string) => {
  const { organizationId } = await requireTeacher(userId);

  const memberIds = (
    await prisma.membership.findMany({
      where: { organizationId, status: MembershipStatus.ACTIVE },
      select: { userId: true },
    })
  ).map((row) => row.userId);

  if (memberIds.length === 0) return [];

  const [goals, offered] = await Promise.all([
    prisma.learningGoal.groupBy({
      by: ["skillId"],
      where: { userId: { in: memberIds }, isActive: true },
      _count: { _all: true },
    }),
    prisma.userSkill.findMany({
      where: { userId: { in: memberIds } },
      select: { skillId: true },
      distinct: ["skillId"],
    }),
  ]);

  const offeredIds = new Set(offered.map((row) => row.skillId));
  const gaps = goals.filter((goal) => !offeredIds.has(goal.skillId));

  if (gaps.length === 0) return [];

  const skills = await prisma.skill.findMany({
    where: { id: { in: gaps.map((gap) => gap.skillId) } },
    select: { id: true, name: true, category: true },
  });
  const skillById = new Map(skills.map((skill) => [skill.id, skill]));

  return gaps
    .map((gap) => ({ skill: skillById.get(gap.skillId), learnersWanting: gap._count._all }))
    .filter((row) => row.skill)
    .sort((a, b) => b.learnersWanting - a.learnersWanting);
};

/**
 * Marks a student's skill as verified by the school. This is the point of
 * UserSkill.isVerified, which nothing wrote until now — and the reason it must
 * be restricted to teachers of that student's own school.
 */
export const verifyStudentSkill = async (
  userId: string,
  userSkillId: string,
  verified: boolean
) => {
  const { organizationId } = await requireTeacher(userId);

  const userSkill = await prisma.userSkill.findUnique({
    where: { id: userSkillId },
    select: { id: true, userId: true },
  });
  if (!userSkill) throw new HttpError(404, "Skill not found");

  const sameSchool = await prisma.membership.findFirst({
    where: {
      userId: userSkill.userId,
      organizationId,
      status: MembershipStatus.ACTIVE,
    },
    select: { id: true },
  });
  if (!sameSchool) {
    throw new HttpError(403, "This user is not a member of your school");
  }

  return prisma.userSkill.update({
    where: { id: userSkillId },
    data: { isVerified: verified },
  });
};
