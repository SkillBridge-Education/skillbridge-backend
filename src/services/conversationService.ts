import { prisma } from "../utils/prisma";
import { HttpError } from "../utils/httpError";
import { createNotificationService } from "./notificationsService";
import { emitToUser } from "../sockets";
import { messageSelect, resolveReplyTarget } from "./messageShape";
import { assertNotBlocked } from "./blockService";

/**
 * Returns all conversations the user participates in, with the last message
 * and the "other" participant pre-computed for the UI.
 */
export const listConversationsService = async (userId: string) => {
  const conversations = await prisma.conversation.findMany({
    where: {
      OR: [
        { firstUserId: userId },
        { secondUserId: userId },
      ],
    },
    include: {
      firstUser: {
        select: { id: true, firstName: true, lastName: true, avatarUrl: true },
      },
      secondUser: {
        select: { id: true, firstName: true, lastName: true, avatarUrl: true },
      },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          sender: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
  });

  return conversations.map((conv) => ({
    id: conv.id,
    status: conv.status,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
    other: conv.firstUserId === userId ? conv.secondUser : conv.firstUser,
    lastMessage: conv.messages[0] ?? null,
  }));
};

/**
 * Returns the metadata (id, status, participants) of a single conversation.
 * Only participants may access it.
 */
export const getConversationService = async (
  conversationId: string,
  userId: string
) => {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      firstUser: { select: { id: true, firstName: true, lastName: true } },
      secondUser: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  if (!conversation) throw new HttpError(404, "Conversation not found");
  if (
    conversation.firstUserId !== userId &&
    conversation.secondUserId !== userId
  ) {
    throw new HttpError(403, "Forbidden");
  }

  return {
    id: conversation.id,
    status: conversation.status,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    other:
      conversation.firstUserId === userId
        ? conversation.secondUser
        : conversation.firstUser,
  };
};

/**
 * Returns all messages of a conversation in chronological order.
 * Only participants may read it.
 */
export const listMessagesService = async (
  conversationId: string,
  userId: string
) => {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
  });

  if (!conversation) throw new HttpError(404, "Conversation not found");
  if (
    conversation.firstUserId !== userId &&
    conversation.secondUserId !== userId
  ) {
    throw new HttpError(403, "Forbidden");
  }

  return prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    select: messageSelect,
  });
};

/**
 * Creates a new message in the conversation.
 * Only participants may post.
 */
export const createMessageService = async (
  conversationId: string,
  userId: string,
  body: string,
  replyToId?: string
) => {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
  });

  if (!conversation) throw new HttpError(404, "Conversation not found");
  if (
    conversation.firstUserId !== userId &&
    conversation.secondUserId !== userId
  ) {
    throw new HttpError(403, "Forbidden");
  }
  if (!body || body.trim() === "") {
    throw new HttpError(400, "Message body cannot be empty");
  }

  const otherId =
    conversation.firstUserId === userId
      ? conversation.secondUserId
      : conversation.firstUserId;
  await assertNotBlocked(userId, otherId);

  const replyTargetId = await resolveReplyTarget(conversationId, replyToId);

  const message = await prisma.message.create({
    data: {
      conversationId,
      senderId: userId,
      body: body.trim(),
      replyToId: replyTargetId,
    },
    select: messageSelect,
  });

  // Notifier l'autre participant
  const recipientId =
    conversation.firstUserId === userId
      ? conversation.secondUserId
      : conversation.firstUserId;
  createNotificationService(
    recipientId,
    "MESSAGE_RECEIVED",
    `Nouveau message de ${message.sender.firstName} ${message.sender.lastName}.`
  ).catch(() => {});

  // Emit to both participants so every open tab/device stays in sync.
  emitToUser(recipientId, "message:new", { conversationId, message });
  emitToUser(userId, "message:new", { conversationId, message });

  return message;
};

export const archiveConversationService = async (
  conversationId: string,
  userId: string
) => {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
  });
  if (!conversation) throw new HttpError(404, "Conversation not found");
  if (conversation.firstUserId !== userId && conversation.secondUserId !== userId) {
    throw new HttpError(403, "Forbidden");
  }
  return prisma.conversation.update({
    where: { id: conversationId },
    data: { status: "ARCHIVED" },
  });
};

export const unarchiveConversationService = async (
  conversationId: string,
  userId: string
) => {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
  });
  if (!conversation) throw new HttpError(404, "Conversation not found");
  if (conversation.firstUserId !== userId && conversation.secondUserId !== userId) {
    throw new HttpError(403, "Forbidden");
  }
  return prisma.conversation.update({
    where: { id: conversationId },
    data: { status: "ACTIVE" },
  });
};

export const deleteConversationService = async (
  conversationId: string,
  userId: string
) => {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
  });
  if (!conversation) throw new HttpError(404, "Conversation not found");
  if (conversation.firstUserId !== userId && conversation.secondUserId !== userId) {
    throw new HttpError(403, "Forbidden");
  }
  await prisma.conversation.delete({ where: { id: conversationId } });
};

export const sendFileMessageService = async (
  conversationId: string,
  userId: string,
  fileUrl: string,
  fileName?: string,
  replyToId?: string
) => {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
  });

  if (!conversation) throw new HttpError(404, "Conversation not found");
  if (
    conversation.firstUserId !== userId &&
    conversation.secondUserId !== userId
  ) {
    throw new HttpError(403, "Forbidden");
  }
  if (!fileUrl) {
    throw new HttpError(400, "File URL cannot be empty");
  }

  const blockedOtherId =
    conversation.firstUserId === userId
      ? conversation.secondUserId
      : conversation.firstUserId;
  await assertNotBlocked(userId, blockedOtherId);

  const replyTargetId = await resolveReplyTarget(conversationId, replyToId);

  const message = await prisma.message.create({
    data: {
      conversationId,
      senderId: userId,
      body: fileUrl,
      fileUrl: fileUrl.trim(),
      fileName: fileName?.trim() || null,
      type: "FILE",
      replyToId: replyTargetId,
    },
    select: messageSelect,
  });

  const recipientId =
    conversation.firstUserId === userId
      ? conversation.secondUserId
      : conversation.firstUserId;
  emitToUser(recipientId, "message:new", { conversationId, message });
  emitToUser(userId, "message:new", { conversationId, message });

  return message;
};
