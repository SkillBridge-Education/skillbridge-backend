import { NextFunction, Request, Response, Router } from "express";
import { Role, SupportTicketCategory, SupportTicketStatus } from "@prisma/client";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { authenticate, authorizeRoles } from "../middleware/authMiddleware";
import { validate } from "../middleware/validate";
import { getAuthenticatedUserId } from "../utils/requestHelpers";
import { verifyToken } from "../utils/jwt";
import { paginationQuerySchema } from "../utils/pagination";
import {
  createTicket,
  listMyTickets,
  listTickets,
  replyToTicket,
  setTicketStatus,
} from "../services/supportService";

const handle =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await fn(req, res);
    } catch (error) {
      next(error);
    }
  };

/** Unauthenticated and free-text, so it is the easiest thing here to abuse. */
const ticketLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ message: "Too many messages sent. Please try again later." });
  },
});

export const supportRouter = Router();

/**
 * Public on purpose. Someone locked out cannot authenticate, and they are
 * precisely who needs to reach support. The token is read if present, so a
 * signed-in sender is linked to their account, but its absence is not an error.
 */
supportRouter.post(
  "/tickets",
  ticketLimiter,
  validate({
    body: z.object({
      subject: z.string().trim().min(3, "A subject is required").max(150),
      body: z.string().trim().min(20, "Please describe your problem in a few words").max(4000),
      category: z.nativeEnum(SupportTicketCategory).default(SupportTicketCategory.OTHER),
      email: z.string().trim().email("A valid email is required").max(200),
      name: z.string().trim().min(1, "A name is required").max(120),
    }),
  }),
  handle(async (req, res) => {
    let userId: string | undefined;
    const header = req.headers.authorization;
    if (header?.startsWith("Bearer ")) {
      try {
        userId = verifyToken(header.split(" ")[1]).userId;
      } catch {
        // An expired token is not a reason to refuse a cry for help.
      }
    }

    const ticket = await createTicket({
      subject: req.body.subject as string,
      body: req.body.body as string,
      category: req.body.category as SupportTicketCategory,
      senderEmail: req.body.email as string,
      senderName: req.body.name as string,
      userId,
    });

    res.status(201).json({ ticket });
  })
);

supportRouter.get(
  "/tickets/mine",
  authenticate,
  handle(async (req, res) => {
    const tickets = await listMyTickets(getAuthenticatedUserId(req));
    res.status(200).json({ tickets });
  })
);

// --- Back-office -----------------------------------------------------------

export const adminSupportRouter = Router();

adminSupportRouter.use(authenticate, authorizeRoles(Role.ADMIN));

adminSupportRouter.get(
  "/tickets",
  validate({
    query: paginationQuerySchema.extend({
      status: z.nativeEnum(SupportTicketStatus).optional(),
    }),
  }),
  handle(async (req, res) => {
    const { status, limit, cursor } = req.query as never;
    const page = await listTickets({ status, limit, cursor });
    res.status(200).json({
      tickets: page.items,
      total: page.items.length,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    });
  })
);

adminSupportRouter.post(
  "/tickets/:id/reply",
  validate({
    params: z.object({ id: z.string().uuid() }),
    body: z.object({ body: z.string().trim().min(1, "A reply cannot be empty").max(4000) }),
  }),
  handle(async (req, res) => {
    const ticket = await replyToTicket(
      getAuthenticatedUserId(req),
      req.params.id as string,
      req.body.body as string
    );
    res.status(200).json({ ticket });
  })
);

adminSupportRouter.patch(
  "/tickets/:id",
  validate({
    params: z.object({ id: z.string().uuid() }),
    body: z.object({ status: z.nativeEnum(SupportTicketStatus) }),
  }),
  handle(async (req, res) => {
    const ticket = await setTicketStatus(
      req.params.id as string,
      req.body.status as SupportTicketStatus
    );
    res.status(200).json({ ticket });
  })
);
