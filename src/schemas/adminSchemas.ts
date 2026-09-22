import { z } from "zod";
import { UserStatus } from "@prisma/client";
import { paginationQuerySchema } from "../utils/pagination";

/**
 * Every privileged action carries a reason. The minimum length is deliberate:
 * a one-character reason satisfies a required field without explaining
 * anything, and the audit trail exists to answer "why".
 */
const reason = z
  .string()
  .trim()
  .min(10, "A reason of at least 10 characters is required")
  .max(500);

export const reasonBodySchema = z.object({ reason });

export const adjustCreditsSchema = z.object({
  // A signed delta, never an absolute balance: an absolute value would silently
  // overwrite anything that happened while the admin had the page open.
  amount: z
    .number()
    .int("Amount must be a whole number of credits")
    .refine((value) => value !== 0, "Amount must not be zero")
    .refine((value) => Math.abs(value) <= 500, "Adjustment cannot exceed 500 credits"),
  reason,
});

export const reviewAppealSchema = z.object({
  decision: z.enum(["GRANTED", "DENIED"]),
  response: reason,
});

export const listUsersQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().min(1).max(100).optional(),
  status: z.nativeEnum(UserStatus).optional(),
});

export const listReportsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["PENDING", "REVIEWING", "ACTIONED", "DISMISSED"]).optional(),
});

export const listOrganizationsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["PENDING", "ACTIVE", "REJECTED", "SUSPENDED"]).optional(),
});

export const listAppealsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["PENDING", "GRANTED", "DENIED"]).optional(),
});

export const listAuditQuerySchema = paginationQuerySchema.extend({
  action: z.string().trim().min(1).max(50).optional(),
  actorId: z.string().uuid().optional(),
});

export const idParamSchema = z.object({
  id: z.string().uuid("A valid id is required"),
});
