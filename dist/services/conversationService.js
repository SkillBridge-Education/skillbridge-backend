"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendFileMessageService = exports.deleteConversationService = exports.unarchiveConversationService = exports.archiveConversationService = exports.createMessageService = exports.listMessagesService = exports.getConversationService = exports.listConversationsService = void 0;
const prisma_1 = require("../utils/prisma");
const httpError_1 = require("../utils/httpError");
const notificationsService_1 = require("./notificationsService");
const sockets_1 = require("../sockets");
/**
 * Returns all conversations the user participates in, with the last message
 * and the "other" participant pre-computed for the UI.
 */
const listConversationsService = async (userId) => {
    const conversations = await prisma_1.prisma.conversation.findMany({
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
exports.listConversationsService = listConversationsService;
/**
 * Returns the metadata (id, status, participants) of a single conversation.
 * Only participants may access it.
 */
const getConversationService = async (conversationId, userId) => {
    const conversation = await prisma_1.prisma.conversation.findUnique({
        where: { id: conversationId },
        include: {
            firstUser: { select: { id: true, firstName: true, lastName: true } },
            secondUser: { select: { id: true, firstName: true, lastName: true } },
        },
    });
    if (!conversation)
        throw new httpError_1.HttpError(404, "Conversation not found");
    if (conversation.firstUserId !== userId &&
        conversation.secondUserId !== userId) {
        throw new httpError_1.HttpError(403, "Forbidden");
    }
    return {
        id: conversation.id,
        status: conversation.status,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        other: conversation.firstUserId === userId
            ? conversation.secondUser
            : conversation.firstUser,
    };
};
exports.getConversationService = getConversationService;
/**
 * Returns all messages of a conversation in chronological order.
 * Only participants may read it.
 */
const listMessagesService = async (conversationId, userId) => {
    const conversation = await prisma_1.prisma.conversation.findUnique({
        where: { id: conversationId },
    });
    if (!conversation)
        throw new httpError_1.HttpError(404, "Conversation not found");
    if (conversation.firstUserId !== userId &&
        conversation.secondUserId !== userId) {
        throw new httpError_1.HttpError(403, "Forbidden");
    }
    return prisma_1.prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: "asc" },
        include: {
            sender: { select: { id: true, firstName: true, lastName: true } },
        },
    });
};
exports.listMessagesService = listMessagesService;
/**
 * Creates a new message in the conversation.
 * Only participants may post.
 */
const createMessageService = async (conversationId, userId, body) => {
    const conversation = await prisma_1.prisma.conversation.findUnique({
        where: { id: conversationId },
    });
    if (!conversation)
        throw new httpError_1.HttpError(404, "Conversation not found");
    if (conversation.firstUserId !== userId &&
        conversation.secondUserId !== userId) {
        throw new httpError_1.HttpError(403, "Forbidden");
    }
    if (!body || body.trim() === "") {
        throw new httpError_1.HttpError(400, "Message body cannot be empty");
    }
    const message = await prisma_1.prisma.message.create({
        data: {
            conversationId,
            senderId: userId,
            body: body.trim(),
        },
        include: {
            sender: { select: { id: true, firstName: true, lastName: true } },
        },
    });
    // Notifier l'autre participant
    const recipientId = conversation.firstUserId === userId
        ? conversation.secondUserId
        : conversation.firstUserId;
    (0, notificationsService_1.createNotificationService)(recipientId, "MESSAGE_RECEIVED", `Nouveau message de ${message.sender.firstName} ${message.sender.lastName}.`).catch(() => { });
    // Emit to both participants so every open tab/device stays in sync.
    (0, sockets_1.emitToUser)(recipientId, "message:new", { conversationId, message });
    (0, sockets_1.emitToUser)(userId, "message:new", { conversationId, message });
    return message;
};
exports.createMessageService = createMessageService;
const archiveConversationService = async (conversationId, userId) => {
    const conversation = await prisma_1.prisma.conversation.findUnique({
        where: { id: conversationId },
    });
    if (!conversation)
        throw new httpError_1.HttpError(404, "Conversation not found");
    if (conversation.firstUserId !== userId && conversation.secondUserId !== userId) {
        throw new httpError_1.HttpError(403, "Forbidden");
    }
    return prisma_1.prisma.conversation.update({
        where: { id: conversationId },
        data: { status: "ARCHIVED" },
    });
};
exports.archiveConversationService = archiveConversationService;
const unarchiveConversationService = async (conversationId, userId) => {
    const conversation = await prisma_1.prisma.conversation.findUnique({
        where: { id: conversationId },
    });
    if (!conversation)
        throw new httpError_1.HttpError(404, "Conversation not found");
    if (conversation.firstUserId !== userId && conversation.secondUserId !== userId) {
        throw new httpError_1.HttpError(403, "Forbidden");
    }
    return prisma_1.prisma.conversation.update({
        where: { id: conversationId },
        data: { status: "ACTIVE" },
    });
};
exports.unarchiveConversationService = unarchiveConversationService;
const deleteConversationService = async (conversationId, userId) => {
    const conversation = await prisma_1.prisma.conversation.findUnique({
        where: { id: conversationId },
    });
    if (!conversation)
        throw new httpError_1.HttpError(404, "Conversation not found");
    if (conversation.firstUserId !== userId && conversation.secondUserId !== userId) {
        throw new httpError_1.HttpError(403, "Forbidden");
    }
    await prisma_1.prisma.conversation.delete({ where: { id: conversationId } });
};
exports.deleteConversationService = deleteConversationService;
const sendFileMessageService = async (conversationId, userId, fileUrl) => {
    const conversation = await prisma_1.prisma.conversation.findUnique({
        where: { id: conversationId },
    });
    if (!conversation)
        throw new httpError_1.HttpError(404, "Conversation not found");
    if (conversation.firstUserId !== userId &&
        conversation.secondUserId !== userId) {
        throw new httpError_1.HttpError(403, "Forbidden");
    }
    if (!fileUrl) {
        throw new httpError_1.HttpError(400, "File URL cannot be empty");
    }
    const message = await prisma_1.prisma.message.create({
        data: {
            conversationId,
            senderId: userId,
            body: fileUrl,
            fileUrl: fileUrl.trim(),
            type: "FILE",
        },
        include: {
            sender: { select: { id: true, firstName: true, lastName: true } },
        },
    });
    const recipientId = conversation.firstUserId === userId
        ? conversation.secondUserId
        : conversation.firstUserId;
    (0, sockets_1.emitToUser)(recipientId, "message:new", { conversationId, message });
    (0, sockets_1.emitToUser)(userId, "message:new", { conversationId, message });
    return message;
};
exports.sendFileMessageService = sendFileMessageService;
//# sourceMappingURL=conversationService.js.map