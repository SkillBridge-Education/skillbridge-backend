import { HttpError } from "./httpError";

export interface UpdateProfileInput {
  firstName?: string;
  lastName?: string;
  bio?: string | null;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
  availability?: string | null; // JSON string
  dateOfBirth?: Date;
}

/**
 * France sets the age of digital consent at 15 under RGPD article 8 / article 45
 * of the loi Informatique et Libertés. Below it, a parent has to consent, which
 * this service has no way to collect — so sign-up is refused instead.
 */
export const MINIMUM_AGE_YEARS = 15;

export interface SkillInput {
  skillId?: string;
  name?: string;
  description?: string | null;
  category?: string | null;
  yearsOfExperience?: number | null;
}

export interface LearningGoalInput {
  skillId?: string;
  name?: string;
  description?: string | null;
  targetLevel?: string | null;
}

const MAX_SHORT_TEXT_LENGTH = 120;
const MAX_LONG_TEXT_LENGTH  = 1000;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const optionalTrimmedString = (
  value: unknown,
  fieldName: string,
  maxLength = MAX_SHORT_TEXT_LENGTH
): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new HttpError(400, `${fieldName} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > maxLength) throw new HttpError(400, `${fieldName} must be ${maxLength} characters or fewer`);
  return trimmed;
};

export const ageOn = (birthDate: Date, reference: Date = new Date()): number => {
  let age = reference.getFullYear() - birthDate.getFullYear();
  const monthDelta = reference.getMonth() - birthDate.getMonth();

  // Not yet had this year's birthday.
  if (monthDelta < 0 || (monthDelta === 0 && reference.getDate() < birthDate.getDate())) {
    age -= 1;
  }

  return age;
};

const optionalDateOfBirth = (value: unknown): Date | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "string" && !(value instanceof Date)) {
    throw new HttpError(400, "dateOfBirth must be a date");
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, "dateOfBirth must be a valid date");
  }

  const age = ageOn(date);

  if (date.getTime() > Date.now()) {
    throw new HttpError(400, "dateOfBirth cannot be in the future");
  }
  if (age > 120) {
    throw new HttpError(400, "dateOfBirth must be a valid date");
  }
  if (age < MINIMUM_AGE_YEARS) {
    throw new HttpError(
      403,
      `You must be at least ${MINIMUM_AGE_YEARS} years old to use SkillBridge`
    );
  }

  return date;
};

const requiredSkillReference = (input: { skillId?: string; name?: string }): void => {
  if (!input.skillId && !input.name) throw new HttpError(400, "skillId or name is required");
};

export const parseUpdateProfileInput = (body: unknown): UpdateProfileInput => {
  if (!isObject(body)) throw new HttpError(400, "Request body must be an object");

  const firstName = optionalTrimmedString(body.firstName, "firstName");
  const lastName  = optionalTrimmedString(body.lastName, "lastName");

  if (firstName === null || lastName === null) {
    throw new HttpError(400, "firstName and lastName cannot be empty");
  }

  const input: UpdateProfileInput = {
    firstName,
    lastName,
    bio:          optionalTrimmedString(body.bio, "bio", MAX_LONG_TEXT_LENGTH),
    avatarUrl:    optionalTrimmedString(body.avatarUrl, "avatarUrl", 500),
    bannerUrl:    optionalTrimmedString(body.bannerUrl, "bannerUrl", 500),
    availability: optionalTrimmedString(body.availability, "availability", 2000),
    dateOfBirth:  optionalDateOfBirth(body.dateOfBirth),
  };

  if (Object.values(input).every((value) => value === undefined)) {
    throw new HttpError(400, "At least one profile field is required");
  }

  return input;
};

export const parseSkillInput = (body: unknown): SkillInput => {
  if (!isObject(body)) throw new HttpError(400, "Request body must be an object");

  const yearsOfExperience = body.yearsOfExperience;
  if (yearsOfExperience !== undefined && yearsOfExperience !== null &&
    (typeof yearsOfExperience !== "number" || !Number.isInteger(yearsOfExperience) || yearsOfExperience < 0)) {
    throw new HttpError(400, "yearsOfExperience must be a non-negative integer");
  }

  const input: SkillInput = {
    skillId: optionalTrimmedString(body.skillId, "skillId") ?? undefined,
    name:    optionalTrimmedString(body.name, "name") ?? undefined,
    description: optionalTrimmedString(body.description, "description", MAX_LONG_TEXT_LENGTH),
    category:    optionalTrimmedString(body.category, "category"),
    yearsOfExperience: yearsOfExperience === undefined ? undefined : (yearsOfExperience as number | null),
  };

  requiredSkillReference(input);
  return input;
};

export const parseLearningGoalInput = (body: unknown): LearningGoalInput => {
  if (!isObject(body)) throw new HttpError(400, "Request body must be an object");

  const input: LearningGoalInput = {
    skillId:     optionalTrimmedString(body.skillId, "skillId") ?? undefined,
    name:        optionalTrimmedString(body.name, "name") ?? undefined,
    description: optionalTrimmedString(body.description, "description", MAX_LONG_TEXT_LENGTH),
    targetLevel: optionalTrimmedString(body.targetLevel, "targetLevel"),
  };

  requiredSkillReference(input);
  return input;
};