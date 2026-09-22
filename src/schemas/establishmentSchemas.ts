import { z } from "zod";

/**
 * Validation for "Mon etablissement".
 *
 * The lists here are closed on purpose. Category, type and teaching mode are
 * read by the reviewer, by the directory filter and by the badge shown to
 * members — three places that have to agree on the wording, which free text
 * cannot guarantee.
 */

export const ORGANIZATION_CATEGORIES = [
  "TECH",
  "BUSINESS_SCHOOL",
  "COMMERCE",
  "ENGINEERING",
  "UNIVERSITY",
  "IUT",
  "BTS",
  "CFA",
  "LYCEE",
  "COLLEGE",
  "DESIGN",
  "ART",
  "COMMUNICATION",
  "ONLINE",
  "TRAINING_CENTER",
  "OTHER",
] as const;

export const ORGANIZATION_TYPES = ["PUBLIC", "PRIVATE", "NONPROFIT", "OTHER"] as const;
export const TEACHING_MODES = ["ON_SITE", "REMOTE", "HYBRID"] as const;

/**
 * The representative's job at the school.
 *
 * Free text with a suggested list on the client rather than an enum: "Autre" is
 * one of the options in the flow, and an enum plus a free-text escape hatch is
 * two fields pretending to be one.
 */
const representativeFunctionSchema = z
  .string()
  .trim()
  .min(2, "Precisez votre fonction dans l'etablissement")
  .max(100);

const optionalText = (max: number) => z.string().trim().max(max).optional();

/**
 * `https` only, and no credentials in the URL.
 *
 * The site is shown to members as a link, so an unvalidated value here is the
 * same stored-XSS hole the chat attachments had.
 */
const websiteSchema = z
  .string()
  .trim()
  .max(300)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch {
      return false;
    }
  }, "Entrez une adresse commencant par https://")
  .optional();

const campusSchema = z.object({
  name: z.string().trim().min(2, "Le nom du campus est requis").max(100),
  city: optionalText(100),
  country: optionalText(100),
  address: optionalText(200),
  postalCode: optionalText(20),
  isOnline: z.boolean().optional(),
});

export const applyForEstablishmentSchema = z.object({
  name: z.string().trim().min(2, "Le nom officiel est requis").max(150),
  shortName: optionalText(30),
  shortDescription: optionalText(200),
  description: optionalText(5000),
  website: websiteSchema,

  /**
   * The institution's own address, and the reason the whole application is
   * credible: it is what our team writes to in order to confirm that the
   * applicant really speaks for this school.
   */
  officialEmail: z
    .string()
    .trim()
    .email("Entrez l'adresse e-mail officielle de l'etablissement")
    .max(200),

  phone: optionalText(30),
  country: optionalText(100),
  city: optionalText(100),
  address: optionalText(200),
  postalCode: optionalText(20),

  category: z.enum(ORGANIZATION_CATEGORIES).optional(),
  type: z.enum(ORGANIZATION_TYPES).optional(),
  teachingMode: z.enum(TEACHING_MODES).optional(),
  languages: z.array(z.string().trim().min(1).max(50)).max(10).optional(),
  studyLevels: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  registrationNumber: optionalText(50),

  representativeFunction: representativeFunctionSchema,
  campuses: z.array(campusSchema).max(50).optional(),
});

// --- Access codes -----------------------------------------------------------

export const issueAccessCodeSchema = z.object({
  role: z.enum(["TEACHER", "STUDENT"]),
  email: z.string().trim().email("Une adresse e-mail valide est requise").max(200),
  firstName: optionalText(60),
  lastName: optionalText(60),
  campusId: z.string().uuid().optional(),
  note: optionalText(200),
});

/**
 * Capped at 1000 rows a call.
 *
 * A school with 3000 pupils paginates its import; a single unbounded request
 * that mints thousands of codes inside one HTTP timeout does not fail cleanly.
 */
export const bulkAccessCodeSchema = z.object({
  rows: z
    .array(
      z.object({
        role: z.enum(["TEACHER", "STUDENT"]),
        email: z.string().trim().email().max(200),
        firstName: optionalText(60),
        lastName: optionalText(60),
        campusId: z.string().uuid().optional(),
      })
    )
    .min(1, "Aucune ligne a importer")
    .max(1000, "Importez au maximum 1000 lignes a la fois"),
});

export const listAccessCodesQuerySchema = z.object({
  role: z.enum(["TEACHER", "STUDENT"]).optional(),
  status: z.enum(["ISSUED", "ACTIVATED", "REVOKED"]).optional(),
});

/**
 * A code as typed by a member. Upper-cased and space-tolerant because it gets
 * dictated, copied out of an email, and typed on a phone keyboard.
 */
export const accessCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^(PROF|STU)-[A-Z0-9]{4,10}$/, "Format attendu : PROF-XXXXXX ou STU-XXXXXX");

export const redeemAccessCodeSchema = z.object({
  code: accessCodeSchema,
  email: z.string().trim().email("Une adresse e-mail valide est requise").max(200),
});

export const codeIdParamSchema = z.object({
  id: z.string().uuid("Identifiant invalide"),
});
