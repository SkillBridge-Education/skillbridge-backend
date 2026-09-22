import { z } from "zod";
import { ReportReason } from "@prisma/client";

export const createReportSchema = z.object({
  reportedUserId: z.string().uuid("A valid user id is required"),
  reason: z.nativeEnum(ReportReason),
  description: z.string().trim().max(2000).optional(),
  messageId: z.string().uuid().optional(),
});

export const createAppealSchema = z.object({
  // Long enough to state a case, bounded so the queue stays reviewable.
  message: z
    .string()
    .trim()
    .min(20, "Please explain your appeal in at least 20 characters")
    .max(2000),
});

export const requestOrganizationSchema = z.object({
  name: z.string().trim().min(2, "Organization name is required").max(150),
  contactName: z.string().trim().min(2, "A contact name is required").max(100),
  contactEmail: z.string().trim().email("A valid contact email is required").max(200),
  // Optional, and only ever a hint for the reviewer: it grants nothing on its own.
  emailDomain: z
    .string()
    .trim()
    .max(100)
    .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, "Enter a domain such as lycee-exemple.fr")
    .optional(),
});

export const userIdParamSchema = z.object({
  id: z.string().uuid("A valid user id is required"),
});
