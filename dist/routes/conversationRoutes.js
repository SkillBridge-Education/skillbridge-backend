"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const authMiddleware_1 = require("../middleware/authMiddleware");
const conversationController_1 = require("../controllers/conversationController");
const router = (0, express_1.Router)();
router.get("/", authMiddleware_1.authenticate, conversationController_1.listConversationsController);
router.get("/:id", authMiddleware_1.authenticate, conversationController_1.getConversationController);
router.get("/:id/messages", authMiddleware_1.authenticate, conversationController_1.listMessagesController);
router.post("/:id/messages", authMiddleware_1.authenticate, conversationController_1.createMessageController);
router.patch("/:id/archive", authMiddleware_1.authenticate, conversationController_1.archiveConversationController);
router.patch("/:id/unarchive", authMiddleware_1.authenticate, conversationController_1.unarchiveConversationController);
router.delete("/:id", authMiddleware_1.authenticate, conversationController_1.deleteConversationController);
// Post a new file message in a conversation
router.post("/:id/messages/file", authMiddleware_1.authenticate, conversationController_1.sendFileMessageController);
exports.default = router;
//# sourceMappingURL=conversationRoutes.js.map