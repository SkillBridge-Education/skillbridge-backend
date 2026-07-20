"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.unarchiveConversationController = exports.archiveConversationController = exports.deleteConversationController = exports.sendFileMessageController = exports.createMessageController = exports.listMessagesController = exports.getConversationController = exports.listConversationsController = void 0;
const requestHelpers_1 = require("../utils/requestHelpers");
const conversationService_1 = require("../services/conversationService");
// GET /conversations
const listConversationsController = async (req, res, next) => {
    try {
        const userId = (0, requestHelpers_1.getAuthenticatedUserId)(req);
        const conversations = await (0, conversationService_1.listConversationsService)(userId);
        res.status(200).json({ conversations });
    }
    catch (error) {
        next(error);
    }
};
exports.listConversationsController = listConversationsController;
// GET /conversations/:id
const getConversationController = async (req, res, next) => {
    try {
        const userId = (0, requestHelpers_1.getAuthenticatedUserId)(req);
        const conversationId = req.params.id;
        const conversation = await (0, conversationService_1.getConversationService)(conversationId, userId);
        res.status(200).json({ conversation });
    }
    catch (error) {
        next(error);
    }
};
exports.getConversationController = getConversationController;
// GET /conversations/:id/messages
const listMessagesController = async (req, res, next) => {
    try {
        const userId = (0, requestHelpers_1.getAuthenticatedUserId)(req);
        const conversationId = req.params.id;
        const messages = await (0, conversationService_1.listMessagesService)(conversationId, userId);
        res.status(200).json({ messages });
    }
    catch (error) {
        next(error);
    }
};
exports.listMessagesController = listMessagesController;
// POST /conversations/:id/messages
const createMessageController = async (req, res, next) => {
    try {
        const userId = (0, requestHelpers_1.getAuthenticatedUserId)(req);
        const conversationId = req.params.id;
        const body = req.body.body;
        const data = await (0, conversationService_1.createMessageService)(conversationId, userId, body);
        res.status(201).json(data);
    }
    catch (error) {
        next(error);
    }
};
exports.createMessageController = createMessageController;
// POST /conversations/:id/messages/file
const sendFileMessageController = async (req, res, next) => {
    try {
        const userId = (0, requestHelpers_1.getAuthenticatedUserId)(req);
        const conversationId = req.params.id;
        const fileUrl = req.body.fileUrl;
        const data = await (0, conversationService_1.sendFileMessageService)(conversationId, userId, fileUrl);
        res.status(201).json(data);
    }
    catch (error) {
        next(error);
    }
};
exports.sendFileMessageController = sendFileMessageController;
// DELETE /conversations/:id
const deleteConversationController = async (req, res, next) => {
    try {
        const userId = (0, requestHelpers_1.getAuthenticatedUserId)(req);
        const conversationId = req.params.id;
        await (0, conversationService_1.deleteConversationService)(conversationId, userId);
        res.status(204).send();
    }
    catch (error) {
        next(error);
    }
};
exports.deleteConversationController = deleteConversationController;
// PATCH /conversations/:id/archive
const archiveConversationController = async (req, res, next) => {
    try {
        const userId = (0, requestHelpers_1.getAuthenticatedUserId)(req);
        const conversationId = req.params.id;
        const data = await (0, conversationService_1.archiveConversationService)(conversationId, userId);
        res.status(200).json(data);
    }
    catch (error) {
        next(error);
    }
};
exports.archiveConversationController = archiveConversationController;
// PATCH /conversations/:id/unarchive
const unarchiveConversationController = async (req, res, next) => {
    try {
        const userId = (0, requestHelpers_1.getAuthenticatedUserId)(req);
        const conversationId = req.params.id;
        const data = await (0, conversationService_1.unarchiveConversationService)(conversationId, userId);
        res.status(200).json(data);
    }
    catch (error) {
        next(error);
    }
};
exports.unarchiveConversationController = unarchiveConversationController;
//# sourceMappingURL=conversationController.js.map