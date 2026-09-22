import { z } from "zod";
import { MAX_CREDITS } from "../services/creditService";

// One credit buys one minute, so a session can never usefully reserve more
// than a full balance: beyond that the learner could never accept it.
const estimatedDuration = z
  .number()
  .int("Duration must be a whole number of minutes")
  .min(5, "A session must last at least 5 minutes")
  .max(MAX_CREDITS, `A session cannot reserve more than ${MAX_CREDITS} credits`);

const scheduledAt = z.coerce
  .date()
  .refine((date) => date.getTime() > Date.now() - 60_000, "A session cannot be scheduled in the past");

export const createSessionSchema = z.object({
  learnerId: z.string().uuid("A valid learner id is required"),
  title: z.string().trim().min(1, "Title is required").max(200),
  estimatedDuration,
  scheduledAt,
});

export const createGroupSessionSchema = z.object({
  learnerIds: z
    .array(z.string().uuid())
    .min(1, "At least one learner is required")
    .max(50, "A group session cannot exceed 50 learners"),
  title: z.string().trim().min(1, "Title is required").max(200),
  estimatedDuration,
  scheduledAt,
});

export const endSessionSchema = z.object({
  // Capped at 24h: a runaway client timer must not be able to bill a learner
  // for an implausible duration.
  durationSeconds: z.number().int().min(0).max(86_400),
});

export const sessionIdParamSchema = z.object({
  id: z.string().uuid("A valid session id is required"),
});
