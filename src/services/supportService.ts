import { Prisma, SupportTicketCategory, SupportTicketStatus } from "@prisma/client";
import { prisma } from "../utils/prisma";
import { HttpError } from "../utils/httpError";
import { toPage, toPrismaPageArgs } from "../utils/pagination";

/**
 * Support tickets.
 *
 * The channel deliberately accepts an unauthenticated sender. The people most
 * likely to need support are the ones who cannot get in — a suspended account,
 * a lost password, a sign-up that failed — so requiring a session would shut out
 * exactly the cases it exists for. The sender's email is always recorded, so a
 * reply reaches them whether or not they had an account.
 */

const ticketSelect = {
  id: true,
  status: true,
  category: true,
  subject: true,
  body: true,
  senderEmail: true,
  senderName: true,
  answeredAt: true,
  createdAt: true,
  user: { select: { id: true, email: true, firstName: true, lastName: true, status: true } },
  answeredBy: { select: { id: true, firstName: true, lastName: true } },
  replies: {
    select: {
      id: true,
      body: true,
      createdAt: true,
      author: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.SupportTicketSelect;

export const createTicket = async (input: {
  subject: string;
  body: string;
  category: SupportTicketCategory;
  senderEmail: string;
  senderName: string;
  userId?: string;
}) => {
  // When the sender is signed in, the account is attached — but the email they
  // typed is kept as given: it may be the only address that still reaches them.
  return prisma.supportTicket.create({
    data: {
      subject: input.subject,
      body: input.body,
      category: input.category,
      senderEmail: input.senderEmail.trim().toLowerCase(),
      senderName: input.senderName,
      userId: input.userId,
    },
    select: { id: true, status: true, category: true, subject: true, createdAt: true },
  });
};

/** A signed-in user's own tickets, so they can see what became of them. */
export const listMyTickets = async (userId: string) =>
  prisma.supportTicket.findMany({
    where: { userId },
    select: ticketSelect,
    orderBy: { createdAt: "desc" },
    take: 50,
  });

// --- Back-office -----------------------------------------------------------

export const listTickets = async (params: {
  status?: SupportTicketStatus;
  limit: number;
  cursor?: string;
}) => {
  const rows = await prisma.supportTicket.findMany({
    where: params.status ? { status: params.status } : {},
    select: ticketSelect,
    // Open tickets first: a queue sorted only by date buries what still needs
    // an answer under what has already been handled.
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    ...toPrismaPageArgs(params),
  });

  return toPage(rows, params.limit);
};

export const replyToTicket = async (adminId: string, ticketId: string, body: string) => {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    select: { id: true, status: true },
  });
  if (!ticket) throw new HttpError(404, "Ticket not found");

  return prisma.$transaction(async (tx) => {
    await tx.supportReply.create({ data: { ticketId, authorId: adminId, body } });

    // Answering reopens nothing and closes nothing: it marks the ticket as
    // answered and leaves closing to a deliberate act.
    return tx.supportTicket.update({
      where: { id: ticketId },
      data: {
        status: SupportTicketStatus.ANSWERED,
        answeredAt: new Date(),
        answeredById: adminId,
      },
      select: ticketSelect,
    });
  });
};

export const setTicketStatus = async (ticketId: string, status: SupportTicketStatus) => {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    select: { id: true },
  });
  if (!ticket) throw new HttpError(404, "Ticket not found");

  return prisma.supportTicket.update({
    where: { id: ticketId },
    data: { status },
    select: ticketSelect,
  });
};
