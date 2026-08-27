import { prisma } from "../utils/prisma";
import { HttpError } from "../utils/httpError";

/**
 * The one shape every message takes on its way out — sent, uploaded or replayed
 * from history.
 *
 * It lives here rather than next to any one of them because the three paths had
 * drifted apart: sending returned a message with no quote, and reloading the
 * thread returned a different set of fields again, so a reply rendered its quote
 * until the screen refreshed and then lost it. A single select is the only way
 * that stays fixed.
 */
export const messageSelect = {
  id: true,
  conversationId: true,
  senderId: true,
  body: true,
  type: true,
  fileUrl: true,
  fileName: true,
  createdAt: true,
  editedAt: true,
  deletedForEveryone: true,
  pinnedAt: true,
  replyToId: true,
  replyTo: {
    select: {
      id: true,
      body: true,
      senderId: true,
      type: true,
      deletedForEveryone: true,
      sender: { select: { id: true, firstName: true, lastName: true } },
    },
  },
  sender: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
} as const;

/**
 * Resolves the message a new one claims to answer.
 *
 * The check that matters is `conversationId`: the quote carries the original's
 * text back to the client, so accepting any id the caller sends would turn the
 * reply field into a way to read messages out of conversations one is not in.
 * The id is therefore only accepted when the message is already in *this*
 * thread — where the sender can read it anyway.
 */
export const resolveReplyTarget = async (
  conversationId: string,
  replyToId: string | undefined
): Promise<string | null> => {
  if (!replyToId) return null;

  const target = await prisma.message.findUnique({
    where: { id: replyToId },
    select: { id: true, conversationId: true, deletedForEveryone: true },
  });

  // Same answer for "does not exist" and "belongs to someone else's thread", so
  // the endpoint cannot be used to test whether a message id exists.
  if (!target || target.conversationId !== conversationId) {
    throw new HttpError(400, "The message being replied to is not part of this conversation");
  }

  // Answering a message that was withdrawn would resurrect its text in the quote.
  if (target.deletedForEveryone) {
    throw new HttpError(400, "That message was deleted and can no longer be replied to");
  }

  return target.id;
};
