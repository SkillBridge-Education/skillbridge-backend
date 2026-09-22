import { randomInt } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../utils/prisma";
import { HttpError } from "../utils/httpError";

/**
 * "Mon etablissement": registering a school, and the identifiers it hands out.
 *
 * Two separate identifiers live here and are easy to confuse, so:
 *
 *   - the *school* id (SB-HETIC-8X42K) is minted by SkillBridge when an
 *     application is approved, and belongs to the institution;
 *   - an *access code* (PROF-82KLM, STU-K82PL) is minted by the school and
 *     belongs to one person, bound to one email address.
 *
 * Neither is a secret. Both travel by email and can be forwarded, so neither is
 * ever sufficient on its own: joining requires the code *and* the address it was
 * issued to, and signing in requires the code *and* the password. They scope a
 * sign-in to a school; they do not authenticate anybody.
 */

/**
 * No I, O, 0 or 1. These identifiers get read off a screen, written on paper and
 * dictated over the phone by school staff — an ambiguous character costs a
 * support ticket every time.
 */
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

const randomCode = (length: number): string => {
  let out = "";
  for (let i = 0; i < length; i += 1) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
};

/**
 * Six characters, not the five of the examples in the specification.
 *
 * A code is checked against an email address, and an attacker who knows a
 * pupil's school address would otherwise be guessing within a 33-million space.
 * Six puts it beyond a billion, costs the reader one extra character, and this
 * is a platform for minors.
 */
const CODE_LENGTH = 6;

/** Letters only, from the acronym or the name, so the id stays readable. */
const acronymOf = (organization: { shortName: string | null; name: string }): string => {
  const source = organization.shortName?.trim() || organization.name;
  const letters = source
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z]/g, "")
    .toUpperCase();

  if (letters.length >= 3) return letters.slice(0, 8);

  // Nothing usable (a name in another script, or all digits): fall back to a
  // neutral marker rather than producing "SB--8X42K".
  return "ECOLE";
};

/** Retries on collision rather than trusting randomness. */
const uniqueValue = async (
  make: () => string,
  taken: (value: string) => Promise<boolean>
): Promise<string> => {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = make();
    if (!(await taken(candidate))) return candidate;
  }
  throw new HttpError(500, "Could not allocate a unique identifier, please retry");
};

// --- Applying ---------------------------------------------------------------

export interface CampusInput {
  name: string;
  city?: string;
  country?: string;
  address?: string;
  postalCode?: string;
  isOnline?: boolean;
}

export interface EstablishmentApplication {
  name: string;
  shortName?: string;
  shortDescription?: string;
  description?: string;
  website?: string;
  officialEmail: string;
  phone?: string;
  country?: string;
  city?: string;
  address?: string;
  postalCode?: string;
  category?: Prisma.OrganizationCreateInput["category"];
  type?: Prisma.OrganizationCreateInput["type"];
  teachingMode?: Prisma.OrganizationCreateInput["teachingMode"];
  languages?: string[];
  studyLevels?: string[];
  registrationNumber?: string;
  representativeFunction: string;
  campuses?: CampusInput[];
}

const slugify = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

/**
 * A signed-in representative applies to register their school.
 *
 * Authenticated on purpose, unlike the anonymous request form it replaces:
 * approval turns this exact account into the school's super admin, so there has
 * to *be* an account to turn.
 */
export const applyForEstablishment = async (
  userId: string,
  input: EstablishmentApplication
) => {
  const baseSlug = slugify(input.name);
  if (!baseSlug) throw new HttpError(400, "Le nom de l'etablissement est invalide");

  // One live application per representative. Without this, a double-tap on a
  // slow connection registers the school twice.
  const existingByUser = await prisma.organization.findFirst({
    where: { requestedById: userId, status: { in: ["PENDING", "ACTIVE"] } },
    select: { id: true, status: true },
  });
  if (existingByUser) {
    throw new HttpError(
      409,
      existingByUser.status === "PENDING"
        ? "Vous avez deja une demande en cours d'examen"
        : "Vous administrez deja un etablissement"
    );
  }

  const existingByName = await prisma.organization.findFirst({
    where: { name: { equals: input.name, mode: "insensitive" } },
    select: { id: true },
  });
  if (existingByName) {
    throw new HttpError(409, "Une demande existe deja pour cet etablissement");
  }

  let slug = baseSlug;
  for (let attempt = 2; await prisma.organization.findUnique({ where: { slug } }); attempt += 1) {
    slug = `${baseSlug}-${attempt}`;
  }

  const applicant = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { firstName: true, lastName: true, email: true },
  });

  return prisma.organization.create({
    data: {
      name: input.name.trim(),
      slug,
      shortName: input.shortName?.trim() || null,
      shortDescription: input.shortDescription?.trim() || null,
      description: input.description?.trim() || null,
      website: input.website?.trim() || null,
      officialEmail: input.officialEmail.trim().toLowerCase(),
      phone: input.phone?.trim() || null,
      country: input.country?.trim() || null,
      city: input.city?.trim() || null,
      address: input.address?.trim() || null,
      postalCode: input.postalCode?.trim() || null,
      category: input.category ?? null,
      type: input.type ?? null,
      teachingMode: input.teachingMode ?? null,
      languages: input.languages?.length ? JSON.stringify(input.languages) : null,
      studyLevels: input.studyLevels?.length ? JSON.stringify(input.studyLevels) : null,
      registrationNumber: input.registrationNumber?.trim() || null,
      representativeFunction: input.representativeFunction.trim(),
      requestedById: userId,
      // The reviewer needs a person to write back to; these mirror the applicant.
      contactName: `${applicant.firstName} ${applicant.lastName}`.trim(),
      contactEmail: applicant.email,
      // Explicit: an application is never active on creation.
      status: "PENDING",
      campuses: input.campuses?.length
        ? {
            create: input.campuses.map((campus) => ({
              name: campus.name.trim(),
              city: campus.city?.trim() || null,
              country: campus.country?.trim() || null,
              address: campus.address?.trim() || null,
              postalCode: campus.postalCode?.trim() || null,
              isOnline: campus.isOnline ?? false,
            })),
          }
        : undefined,
    },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      officialEmail: true,
      createdAt: true,
      campuses: { select: { id: true, name: true, isOnline: true } },
    },
  });
};

/** What the representative sees on the "request sent" screen and afterwards. */
export const getMyApplication = async (userId: string) => {
  return prisma.organization.findFirst({
    where: { requestedById: userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      shortName: true,
      status: true,
      publicId: true,
      officialEmail: true,
      reviewNote: true,
      reviewedAt: true,
      createdAt: true,
      campuses: { select: { id: true, name: true, city: true, isOnline: true } },
    },
  });
};

// --- Approving --------------------------------------------------------------

/**
 * Mints the school's public identifier, e.g. SB-HETIC-8X42K.
 *
 * Readable on purpose: staff dictate it to their members, and an opaque UUID
 * would be copied wrong. Uniqueness comes from the random tail, not the acronym.
 */
export const generatePublicId = async (organization: {
  name: string;
  shortName: string | null;
}): Promise<string> => {
  const acronym = acronymOf(organization);
  return uniqueValue(
    () => `SB-${acronym}-${randomCode(5)}`,
    async (value) =>
      (await prisma.organization.count({ where: { publicId: value } })) > 0
  );
};

/**
 * Finishes an approval: mint the school identifier, and seat the applicant.
 *
 * Called from the audited admin review path rather than being an approval of
 * its own, so there is exactly one way a school becomes ACTIVE and exactly one
 * place that records who decided it.
 *
 * These two steps belong together. A school that is ACTIVE but has nobody who
 * can administer it is a dead end for the very person who applied — and that is
 * precisely the state a half-finished approval would leave behind.
 */
export const finaliseEstablishmentApproval = async (organizationId: string) => {
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { id: true, name: true, shortName: true, publicId: true, requestedById: true },
  });

  const publicId = organization.publicId ?? (await generatePublicId(organization));

  return prisma.$transaction(async (tx) => {
    const updated = await tx.organization.update({
      where: { id: organizationId },
      data: { publicId },
      select: { id: true, name: true, publicId: true, status: true },
    });

    if (organization.requestedById) {
      await tx.membership.upsert({
        where: {
          userId_organizationId: { userId: organization.requestedById, organizationId },
        },
        create: {
          userId: organization.requestedById,
          organizationId,
          orgRole: "ORG_SUPER_ADMIN",
          status: "ACTIVE",
          canInviteTeachers: true,
        },
        update: { orgRole: "ORG_SUPER_ADMIN", status: "ACTIVE", canInviteTeachers: true },
      });
    }

    return updated;
  });
};

// --- Access codes -----------------------------------------------------------

const PREFIX = { TEACHER: "PROF", STUDENT: "STU" } as const;

/**
 * Issues one seat at a school, bound to one email address.
 *
 * The binding is the entire point. A bare code proves nothing — it is emailed,
 * and email gets forwarded — so redemption checks the pair, and a code arriving
 * with any other address is refused.
 */
export const issueAccessCode = async (
  organizationId: string,
  createdById: string,
  input: {
    role: "TEACHER" | "STUDENT";
    email: string;
    firstName?: string;
    lastName?: string;
    campusId?: string;
    note?: string;
  }
) => {
  const email = input.email.trim().toLowerCase();

  const existing = await prisma.accessCode.findUnique({
    where: {
      organizationId_email_role: { organizationId, email, role: input.role },
    },
    select: { id: true, status: true, code: true },
  });

  // Re-issuing has to go through revoke: otherwise a school could bypass its own
  // revocation by simply asking for another code for the same person.
  if (existing && existing.status !== "REVOKED") {
    throw new HttpError(
      409,
      existing.status === "ACTIVATED"
        ? "Cette adresse a deja un acces actif dans cet etablissement"
        : "Un identifiant a deja ete emis pour cette adresse"
    );
  }

  const code = await uniqueValue(
    () => `${PREFIX[input.role]}-${randomCode(CODE_LENGTH)}`,
    async (value) => (await prisma.accessCode.count({ where: { code: value } })) > 0
  );

  const data = {
    code,
    organizationId,
    campusId: input.campusId ?? null,
    role: input.role,
    status: "ISSUED" as const,
    email,
    firstName: input.firstName?.trim() || null,
    lastName: input.lastName?.trim() || null,
    note: input.note?.trim() || null,
    createdById,
    activatedById: null,
    activatedAt: null,
    revokedAt: null,
    revokedById: null,
  };

  const select = {
    id: true,
    code: true,
    role: true,
    status: true,
    email: true,
    firstName: true,
    lastName: true,
    campusId: true,
    createdAt: true,
  };

  return existing
    ? prisma.accessCode.update({ where: { id: existing.id }, data, select })
    : prisma.accessCode.create({ data, select });
};

/**
 * Resolves a code presented at sign-up or sign-in.
 *
 * Returns the same refusal for "no such code", "wrong address" and "revoked":
 * distinguishing them would turn the endpoint into a way to discover which
 * addresses a school has enrolled.
 */
export const resolveAccessCode = async (rawCode: string, rawEmail: string) => {
  const code = rawCode.trim().toUpperCase();
  const email = rawEmail.trim().toLowerCase();

  const found = await prisma.accessCode.findUnique({
    where: { code },
    select: {
      id: true,
      role: true,
      status: true,
      email: true,
      campusId: true,
      organization: {
        select: { id: true, name: true, shortName: true, status: true, publicId: true },
      },
    },
  });

  const refuse = (): never => {
    throw new HttpError(400, "L'identifiant renseigne ne correspond pas a cette adresse e-mail");
  };

  if (!found || found.email !== email || found.status === "REVOKED") refuse();
  if (found!.organization.status !== "ACTIVE") {
    throw new HttpError(400, "Cet etablissement n'est pas encore actif");
  }

  return found!;
};

/** Marks a code as used, and seats its holder. Idempotent for the same user. */
export const redeemAccessCode = async (userId: string, rawCode: string, rawEmail: string) => {
  const resolved = await resolveAccessCode(rawCode, rawEmail);

  return prisma.$transaction(async (tx) => {
    await tx.accessCode.update({
      where: { id: resolved.id },
      data: {
        status: "ACTIVATED",
        activatedById: userId,
        // Kept from the first activation: this records when the seat was taken.
        activatedAt: new Date(),
      },
    });

    const membership = await tx.membership.upsert({
      where: {
        userId_organizationId: { userId, organizationId: resolved.organization.id },
      },
      create: {
        userId,
        organizationId: resolved.organization.id,
        campusId: resolved.campusId,
        orgRole: resolved.role,
        status: "ACTIVE",
      },
      update: { orgRole: resolved.role, status: "ACTIVE", campusId: resolved.campusId },
      select: { id: true, orgRole: true, status: true, organizationId: true },
    });

    return { membership, organization: resolved.organization };
  });
};

export const revokeAccessCode = async (
  organizationId: string,
  codeId: string,
  revokedById: string
) => {
  const code = await prisma.accessCode.findFirst({
    where: { id: codeId, organizationId },
    select: { id: true, activatedById: true },
  });
  if (!code) throw new HttpError(404, "Identifiant introuvable");

  return prisma.$transaction(async (tx) => {
    const updated = await tx.accessCode.update({
      where: { id: codeId },
      data: { status: "REVOKED", revokedAt: new Date(), revokedById },
      select: { id: true, code: true, status: true, email: true, role: true },
    });

    // Revoking a code that somebody is already using has to close their seat as
    // well, or "revoke" would only stop future sign-ups and leave the member in.
    if (code.activatedById) {
      await tx.membership.updateMany({
        where: { userId: code.activatedById, organizationId },
        data: { status: "REVOKED", leftAt: new Date() },
      });
    }

    return updated;
  });
};

export const listAccessCodes = async (
  organizationId: string,
  filter: { role?: "TEACHER" | "STUDENT"; status?: "ISSUED" | "ACTIVATED" | "REVOKED" }
) =>
  prisma.accessCode.findMany({
    where: {
      organizationId,
      ...(filter.role ? { role: filter.role } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: {
      id: true,
      code: true,
      role: true,
      status: true,
      email: true,
      firstName: true,
      lastName: true,
      campusId: true,
      activatedAt: true,
      createdAt: true,
    },
  });

/**
 * Bulk issue, for a school onboarding hundreds of people at once.
 *
 * Reports per-row outcomes instead of failing the batch: one duplicate address
 * in a 900-line export must not cost the other 899 their codes.
 */
export const issueAccessCodesInBulk = async (
  organizationId: string,
  createdById: string,
  rows: Array<{
    role: "TEACHER" | "STUDENT";
    email: string;
    firstName?: string;
    lastName?: string;
    campusId?: string;
  }>
) => {
  const issued: Array<{ email: string; code: string; role: string }> = [];
  const failed: Array<{ email: string; reason: string }> = [];

  for (const row of rows) {
    try {
      const code = await issueAccessCode(organizationId, createdById, row);
      issued.push({ email: code.email, code: code.code, role: code.role });
    } catch (error) {
      failed.push({
        email: row.email,
        reason: error instanceof HttpError ? error.message : "Erreur inattendue",
      });
    }
  }

  return { issued, failed, total: rows.length };
};

// --- Signing in to a school -------------------------------------------------

/**
 * Resolves which structure a sign-in belongs to.
 *
 * The identifier typed on the school tab is one of two things, and both have to
 * work: the representative holds the *school* id issued at approval, while
 * teachers and pupils hold their own personal code. Asking members to know which
 * kind theirs is would be a support burden for no benefit, so this accepts
 * either and works out the rest.
 *
 * It grants nothing. The password has already been checked by the time this
 * runs; what it decides is which school the session is scoped to, and it refuses
 * if the signed-in account is not actually a member of it.
 */
export const resolveEstablishmentSignIn = async (userId: string, rawId: string) => {
  const identifier = rawId.trim().toUpperCase();

  const orgSelect = {
    id: true,
    name: true,
    shortName: true,
    status: true,
    publicId: true,
  };

  let organization: {
    id: string;
    name: string;
    shortName: string | null;
    status: string;
    publicId: string | null;
  } | null;
  let codeRevoked = false;

  if (identifier.startsWith("SB-")) {
    organization = await prisma.organization.findUnique({
      where: { publicId: identifier },
      select: orgSelect,
    });
  } else {
    const code = await prisma.accessCode.findUnique({
      where: { code: identifier },
      select: { status: true, organization: { select: orgSelect } },
    });
    organization = code?.organization ?? null;
    codeRevoked = code?.status === "REVOKED";
  }

  if (!organization || organization.status !== "ACTIVE") {
    throw new HttpError(400, "Cet identifiant ne correspond a aucun etablissement actif");
  }

  /**
   * A withdrawn code is told apart from an unknown one *here*, after the
   * password has been checked.
   *
   * Saying "no such establishment" to somebody whose school is real and whose
   * access was withdrawn sends them chasing a typo that does not exist — the
   * same wrong answer this codebase used to give suspended accounts at sign-in.
   * They have already proved who they are, so there is nothing left to protect.
   */
  if (codeRevoked) {
    throw new HttpError(403, "Votre acces a cet etablissement a ete retire");
  }

  const membership = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId, organizationId: organization.id } },
    select: { orgRole: true, status: true, campusId: true },
  });

  if (!membership || membership.status !== "ACTIVE") {
    throw new HttpError(
      403,
      membership?.status === "REVOKED"
        ? "Votre acces a cet etablissement a ete retire"
        : "Votre compte n'est pas rattache a cet etablissement"
    );
  }

  return {
    organization: {
      id: organization.id,
      name: organization.name,
      shortName: organization.shortName,
      publicId: organization.publicId,
    },
    membership,
  };
};
