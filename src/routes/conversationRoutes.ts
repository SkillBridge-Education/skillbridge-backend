import { Router } from "express";
import { authenticate } from "../middleware/authMiddleware";
import { validate } from "../middleware/validate";
import { contentRateLimiter } from "../middleware/rateLimit";
import {
  conversationIdParamSchema,
  sendFileMessageSchema,
  sendMessageSchema,
} from "../schemas/messageSchemas";
import {
  listConversationsController,
  getConversationController,
  listMessagesController,
  createMessageController,
  sendFileMessageController,
  archiveConversationController,
  unarchiveConversationController,
  deleteConversationController,
} from "../controllers/conversationController";

const router = Router();

const withId = validate({ params: conversationIdParamSchema });

router.get("/",              authenticate, listConversationsController);
router.get("/:id",           authenticate, withId, getConversationController);
router.get("/:id/messages",  authenticate, withId, listMessagesController);
router.post(
  "/:id/messages",
  authenticate,
  contentRateLimiter,
  withId,
  validate({ body: sendMessageSchema }),
  createMessageController
);
router.patch("/:id/archive",   authenticate, withId, archiveConversationController);
router.patch("/:id/unarchive", authenticate, withId, unarchiveConversationController);
router.delete("/:id",          authenticate, withId, deleteConversationController);

// Attachments are client-supplied URLs, so the URL is the whole trust boundary.
router.post(
  "/:id/messages/file",
  authenticate,
  contentRateLimiter,
  withId,
  validate({ body: sendFileMessageSchema }),
  sendFileMessageController
);

export default router;