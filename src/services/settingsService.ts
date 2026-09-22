import { Prisma } from "@prisma/client";
import { prisma } from "../utils/prisma";
import { MAX_CREDITS } from "./creditService";
import { MINIMUM_AGE_YEARS } from "../utils/profileValidation";
import { AUTO_SUSPEND_THRESHOLD } from "./moderationService";

/**
 * Platform settings.
 *
 * Stored per key so adding one is an insert rather than a migration. The
 * defaults below are the values the code already uses, read from their own
 * modules rather than repeated here — a settings screen that disagrees with the
 * running code is worse than no settings screen.
 */

export interface PlatformSettings {
  signupCredits: number;
  creditsPerSessionHour: number;
  minimumAge: number;
  registrationOpen: boolean;
  requireOrganizationApproval: boolean;
  maintenanceMode: boolean;
  autoSuspendThreshold: number;
  supportEmail: string;
}

const DEFAULTS: PlatformSettings = {
  // Matches the Prisma default on User.credits.
  signupCredits: 120,
  // One credit buys one minute, so an hour costs sixty.
  creditsPerSessionHour: 60,
  minimumAge: MINIMUM_AGE_YEARS,
  registrationOpen: true,
  // Manual review is what keeps school mode out of self-service; defaulting it
  // to false would quietly remove that guarantee.
  requireOrganizationApproval: true,
  maintenanceMode: false,
  autoSuspendThreshold: AUTO_SUSPEND_THRESHOLD,
  supportEmail: "support@skillbridge.example",
};

/** Bounds, so a mistyped value cannot break the economy or the age gate. */
const LIMITS: Record<string, { min: number; max: number }> = {
  signupCredits: { min: 0, max: MAX_CREDITS },
  creditsPerSessionHour: { min: 1, max: MAX_CREDITS },
  // Never below the French age of digital consent: lowering it would put the
  // service in breach, so the setting cannot be used to do it.
  minimumAge: { min: MINIMUM_AGE_YEARS, max: 99 },
  // Zero disables auto-suspension; below three, a couple of people could
  // silence anyone.
  autoSuspendThreshold: { min: 0, max: 50 },
};

const parse = (key: string, raw: string): unknown => {
  const fallback = DEFAULTS[key as keyof PlatformSettings];
  if (typeof fallback === "boolean") return raw === "true";
  if (typeof fallback === "number") {
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  }
  return raw;
};

export const getSettings = async (): Promise<PlatformSettings> => {
  const rows = await prisma.platformSetting.findMany();
  const stored = Object.fromEntries(rows.map((row) => [row.key, parse(row.key, row.value)]));

  // Defaults first: a key that was never set, or was removed, still answers
  // with what the code actually does.
  return { ...DEFAULTS, ...stored } as PlatformSettings;
};

export const updateSettings = async (
  adminId: string,
  patch: Partial<PlatformSettings>
): Promise<PlatformSettings> => {
  const entries = Object.entries(patch).filter(([key]) => key in DEFAULTS);

  await prisma.$transaction(
    entries.map(([key, value]) => {
      let stored = value;

      const limit = LIMITS[key];
      if (limit && typeof value === "number") {
        stored = Math.min(limit.max, Math.max(limit.min, value));
      }

      const data = { value: String(stored), updatedById: adminId };
      return prisma.platformSetting.upsert({
        where: { key },
        update: data,
        create: { key, ...data },
      }) as Prisma.PrismaPromise<unknown>;
    })
  );

  return getSettings();
};
