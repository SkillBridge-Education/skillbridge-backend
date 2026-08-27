import { prisma } from "../utils/prisma";
import { HttpError } from "../utils/httpError";
import { requireOrgAdmin, getActiveMembership } from "./organizationService";

/**
 * Cours et evenements : ce que l'interface etablissement expose et que le
 * compte personnel n'a pas.
 *
 * La difference avec une TeachingSession est deliberee. Une session est un
 * echange entre deux personnes qui se sont trouvees et qui coute des credits ;
 * un cours est programme par l'ecole pour un groupe et ne coute rien, parce
 * qu'en mode etablissement l'enseignement est un service de l'ecole et non un
 * echange marchand.
 *
 * Tout est cadre a l'etablissement du demandeur. Aucune fonction ici n'accepte
 * un `organizationId` venu du client : il est toujours lu depuis l'adhesion,
 * sans quoi un membre pourrait lire — ou remplir — l'agenda d'une autre ecole.
 */

/** L'adhesion active du demandeur, ou un refus. Jamais un identifiant du client. */
const requireMember = async (userId: string) => {
  const membership = await getActiveMembership(userId);

  if (!membership) {
    throw new HttpError(403, "Cette fonctionnalite est reservee aux membres d'un etablissement");
  }
  if (membership.organization.status !== "ACTIVE") {
    throw new HttpError(403, "Cet etablissement n'est pas actif");
  }

  return membership;
};

const courseSelect = {
  id: true,
  title: true,
  description: true,
  studyLevel: true,
  startsAt: true,
  endsAt: true,
  location: true,
  isOnline: true,
  capacity: true,
  cancelledAt: true,
  campusId: true,
  teacher: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
  _count: { select: { participants: true } },
} as const;

const eventSelect = {
  id: true,
  title: true,
  description: true,
  startsAt: true,
  endsAt: true,
  location: true,
  bannerUrl: true,
  isPinned: true,
  cancelledAt: true,
  campusId: true,
} as const;

// --- Cours ------------------------------------------------------------------

export interface CourseInput {
  title: string;
  description?: string;
  studyLevel?: string;
  teacherId?: string;
  startsAt: Date;
  endsAt?: Date;
  location?: string;
  isOnline?: boolean;
  capacity?: number;
  campusId?: string;
}

/**
 * L'agenda des cours de l'etablissement.
 *
 * Les cours passes sont exclus par defaut : un onglet qui s'ouvre sur ce qui a
 * deja eu lieu oblige a faire defiler pour trouver ce qui vient.
 */
export const listCourses = async (
  userId: string,
  params: { past?: boolean; mine?: boolean; limit?: number } = {}
) => {
  const membership = await requireMember(userId);
  const now = new Date();

  return prisma.course.findMany({
    where: {
      organizationId: membership.organizationId,
      ...(params.past ? { startsAt: { lt: now } } : { startsAt: { gte: now } }),
      ...(params.mine
        ? { OR: [{ teacherId: userId }, { participants: { some: { userId } } }] }
        : {}),
    },
    select: {
      ...courseSelect,
      participants: { where: { userId }, select: { id: true } },
    },
    orderBy: { startsAt: params.past ? "desc" : "asc" },
    take: Math.min(params.limit ?? 50, 100),
  });
};

/**
 * Cree un cours.
 *
 * Un professeur peut programmer le sien, un administrateur peut en programmer
 * pour n'importe quel professeur de l'ecole. Un eleve, non : c'est la
 * difference entre un cours et une session.
 */
export const createCourse = async (userId: string, input: CourseInput) => {
  const membership = await requireMember(userId);

  const isAdmin = membership.orgRole === "ORG_ADMIN" || membership.orgRole === "ORG_SUPER_ADMIN";
  const isTeacher = membership.orgRole === "TEACHER";

  if (!isAdmin && !isTeacher) {
    throw new HttpError(403, "Seuls les professeurs et les administrateurs creent des cours");
  }

  // Un professeur ne programme que ses propres cours.
  const teacherId = isAdmin ? (input.teacherId ?? userId) : userId;

  if (isAdmin && input.teacherId && input.teacherId !== userId) {
    const target = await prisma.membership.findUnique({
      where: {
        userId_organizationId: {
          userId: input.teacherId,
          organizationId: membership.organizationId,
        },
      },
      select: { orgRole: true, status: true },
    });
    if (!target || target.status !== "ACTIVE") {
      throw new HttpError(400, "Ce professeur n'est pas membre actif de l'etablissement");
    }
  }

  if (input.endsAt && input.endsAt <= input.startsAt) {
    throw new HttpError(400, "La fin du cours doit suivre son debut");
  }

  return prisma.course.create({
    data: {
      organizationId: membership.organizationId,
      campusId: input.campusId ?? membership.campusId ?? null,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      studyLevel: input.studyLevel?.trim() || null,
      teacherId,
      startsAt: input.startsAt,
      endsAt: input.endsAt ?? null,
      location: input.location?.trim() || null,
      isOnline: input.isOnline ?? false,
      capacity: input.capacity ?? null,
      createdById: userId,
    },
    select: courseSelect,
  });
};

/** S'inscrire a un cours de son etablissement. */
export const joinCourse = async (userId: string, courseId: string) => {
  const membership = await requireMember(userId);

  const course = await prisma.course.findFirst({
    where: { id: courseId, organizationId: membership.organizationId },
    select: { id: true, capacity: true, cancelledAt: true, _count: { select: { participants: true } } },
  });
  if (!course) throw new HttpError(404, "Cours introuvable");
  if (course.cancelledAt) throw new HttpError(400, "Ce cours a ete annule");

  if (course.capacity !== null && course._count.participants >= course.capacity) {
    throw new HttpError(400, "Ce cours est complet");
  }

  // Idempotent : reappuyer sur "s'inscrire" ne doit pas produire une erreur.
  await prisma.courseParticipant.upsert({
    where: { courseId_userId: { courseId, userId } },
    create: { courseId, userId },
    update: {},
  });

  return { joined: true };
};

export const leaveCourse = async (userId: string, courseId: string) => {
  await requireMember(userId);
  await prisma.courseParticipant.deleteMany({ where: { courseId, userId } });
  return { joined: false };
};

/** Annule un cours sans le supprimer : ceux qui s'y etaient inscrits doivent le voir. */
export const cancelCourse = async (userId: string, courseId: string) => {
  const membership = await requireMember(userId);

  const course = await prisma.course.findFirst({
    where: { id: courseId, organizationId: membership.organizationId },
    select: { id: true, teacherId: true },
  });
  if (!course) throw new HttpError(404, "Cours introuvable");

  const isAdmin = membership.orgRole === "ORG_ADMIN" || membership.orgRole === "ORG_SUPER_ADMIN";
  if (!isAdmin && course.teacherId !== userId) {
    throw new HttpError(403, "Seul le professeur du cours ou un administrateur peut l'annuler");
  }

  return prisma.course.update({
    where: { id: courseId },
    data: { cancelledAt: new Date() },
    select: courseSelect,
  });
};

// --- Evenements -------------------------------------------------------------

export interface EventInput {
  title: string;
  description?: string;
  startsAt: Date;
  endsAt?: Date;
  location?: string;
  bannerUrl?: string;
  isPinned?: boolean;
  campusId?: string;
}

/** Les evenements a venir, les epingles en tete. */
export const listEvents = async (userId: string, params: { past?: boolean } = {}) => {
  const membership = await requireMember(userId);
  const now = new Date();

  return prisma.schoolEvent.findMany({
    where: {
      organizationId: membership.organizationId,
      ...(params.past ? { startsAt: { lt: now } } : { startsAt: { gte: now } }),
    },
    select: eventSelect,
    orderBy: params.past
      ? [{ startsAt: "desc" }]
      : [{ isPinned: "desc" }, { startsAt: "asc" }],
    take: 100,
  });
};

/** Creer un evenement est un acte d'administration : il s'adresse a toute l'ecole. */
export const createEvent = async (userId: string, input: EventInput) => {
  const { organizationId } = await requireOrgAdmin(userId);

  if (input.endsAt && input.endsAt <= input.startsAt) {
    throw new HttpError(400, "La fin de l'evenement doit suivre son debut");
  }

  return prisma.schoolEvent.create({
    data: {
      organizationId,
      campusId: input.campusId ?? null,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      startsAt: input.startsAt,
      endsAt: input.endsAt ?? null,
      location: input.location?.trim() || null,
      bannerUrl: input.bannerUrl?.trim() || null,
      isPinned: input.isPinned ?? false,
      createdById: userId,
    },
    select: eventSelect,
  });
};

export const cancelEvent = async (userId: string, eventId: string) => {
  const { organizationId } = await requireOrgAdmin(userId);

  const event = await prisma.schoolEvent.findFirst({
    where: { id: eventId, organizationId },
    select: { id: true },
  });
  if (!event) throw new HttpError(404, "Evenement introuvable");

  return prisma.schoolEvent.update({
    where: { id: eventId },
    data: { cancelledAt: new Date() },
    select: eventSelect,
  });
};
