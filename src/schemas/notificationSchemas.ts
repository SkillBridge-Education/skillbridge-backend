import { z } from "zod";
import { NotificationType } from "@prisma/client";

// Derived from the Prisma enum so a new notification type cannot be added to
// the schema and silently rejected here — or worse, reach Prisma unvalidated
// and surface as a 500.
export const createNotificationSchema = z.object({
  type: z.nativeEnum(NotificationType),
  message: z.string().trim().min(1, "Message is required").max(500),
});

export const notificationIdParamSchema = z.object({
  id: z.string().uuid("A valid notification id is required"),
});
