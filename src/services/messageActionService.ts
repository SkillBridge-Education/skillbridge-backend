import { prisma } from "../utils/prisma";
import { HttpError } from "../utils/httpError";
import { emitToUser } from "../sockets";

/**
 * Editing, deleting and pinning messages.
 *
 * The rule that shapes all of it: a message is not only its author's. The other
 * participant read it, may have replied to it, and may have acted on it. So
 * nothing here removes a row — deletions leave a tombstone, and "delete for me"
 * is recorded per user rather than as a flag on the message.
 */

/** How long an author may still edit. Beyond it, the other side has moved on. */
const EDIT_WINDOW_MINUTES = 15;

const participantsOf = async (conversationId: string) => {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { firstUserId: true, secondUserId: true },
  });
  if (!conversation) throw new HttpError(404, "Conversation not found");
  return [conversation.firstUserId, conversation.secondUserId];
};

const requireParticipant = async (conversationId: string, userId: string) => {
  const participants = await participantsOf(conversationId);
  if (!participants.includes(userId)) throw new HttpError(403, "Forbidden");
  return participants;
};

const loadMessage = async (conversationId: string, messageId: string) => {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      conversationId: true,
      senderId: true,
      body: true,
      createdAt: true,
      deletedForEveryone: true,
      pinnedAt: true,
    },
  });

  if (!message || message.conversationId !== conversationId) {
    throw new HttpError(404, "Message not found");
  }
  return message;
};

/** Shape returned to clients and broadcast over the socket. */
const messageSelect = {
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
      deletedForEveryone: true,
      sender: { select: { id: true, firstName: true, lastName: true } },
    },
  },
  sender: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
};

const broadcast = async (
  conversationId: string,
  event: "message:updated" | "message:deleted",
  payload: unknown
) => {
  const participants = await participantsOf(conversationId);
  for (const participant of participants) {
    emitToUser(participant, event, { conversationId, message: payload });
  }
};

export const editMessage = async (
  conversationId: string,
  messageId: string,
  userId: string,
  body: string
) => {
  await requireParticipant(conversationId, userId);
  const message = await loadMessage(conversationId, messageId);

  // Only the author, and only their own words.
  if (message.senderId !== userId) {
    throw new HttpError(403, "You can only edit your own messages");
  }
  if (message.deletedForEveryone) {
    throw new HttpError(400, "This message has been deleted");
  }

  const ageMinutes = (Date.now() - message.createdAt.getTime()) / 60_000;
  if (ageMinutes > EDIT_WINDOW_MINUTES) {
    throw new HttpError(
      400,
      `A message can only be edited within ${EDIT_WINDOW_MINUTES} minutes of being sent`
    );
  }

  const updated = await prisma.message.update({
    where: { id: messageId },
    data: { body, editedAt: new Date() },
    select: messageSelect,
  });

  await broadcast(conversationId, "message:updated", updated);
  return updated;
};

/**
 * `scope: "me"` hides the message for the caller alone. `scope: "everyone"`
 * clears the body for both sides but keeps the row, so replies pointing at it
 * and the order of the conversation survive.
 */
export const deleteMessage = async (
  conversationId: string,
  messageId: string,
  userId: string,
  scope: "me" | "everyone"
) => {
  await requireParticipant(conversationId, userId);
  const message = await loadMessage(conversationId, messageId);

  if (scope === "me") {
    await prisma.messageHide.upsert({
      where: { messageId_userId: { messageId, userId } },
      update: {},
      create: { messageId, userId },
    });
    // Not broadcast: the other participant still sees it, and telling them
    // would leak a private action.
    return { id: messageId, hiddenForMe: true };
  }

  if (message.senderId !== userId) {
    throw new HttpError(403, "You can only delete your own messages for everyone");
  }
  if (message.deletedForEveryone) {
    return loadMessage(conversationId, messageId);
  }

  const updated = await prisma.message.update({
    where: { id: messageId },
    data: {
      body: "",
      fileUrl: null,
      fileName: null,
      deletedForEveryone: true,
      deletedAt: new Date(),
      pinnedAt: null,
      pinnedById: null,
    },
    select: messageSelect,
  });

  await broadcast(conversationId, "message:deleted", updated);
  return updated;
};

/**
 * Pinning is a property of the conversation, not of the author: either
 * participant may pin any message, and either may unpin it.
 */
export const setMessagePin = async (
  conversationId: string,
  messageId: string,
  userId: string,
  pinned: boolean
) => {
  await requireParticipant(conversationId, userId);
  const message = await loadMessage(conversationId, messageId);

  if (pinned && message.deletedForEveryone) {
    throw new HttpError(400, "A deleted message cannot be pinned");
  }

  const updated = await prisma.message.update({
    where: { id: messageId },
    data: pinned
      ? { pinnedAt: new Date(), pinnedById: userId }
      : { pinnedAt: null, pinnedById: null },
    select: messageSelect,
  });

  await broadcast(conversationId, "message:updated", updated);
  return updated;
};

export const listPinnedMessages = async (conversationId: string, userId: string) => {
  await requireParticipant(conversationId, userId);

  return prisma.message.findMany({
    where: {
      conversationId,
      pinnedAt: { not: null },
      deletedForEveryone: false,
      hiddenFor: { none: { userId } },
    },
    select: messageSelect,
    orderBy: { pinnedAt: "desc" },
    take: 20,
  });
};

export { messageSelect };
