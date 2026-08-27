import { Router } from "express";
import { authenticate } from "../middleware/authMiddleware";
import { validate } from "../middleware/validate";
import { contentRateLimiter } from "../middleware/rateLimit";
import {
  deleteMessageController,
  editMessageController,
  listPinnedController,
  pinMessageController,
  unpinMessageController,
} from "../controllers/messageActionController";
import {
  conversationIdParamSchema,
  deleteMessageQuerySchema,
  editMessageSchema,
  messageParamsSchema,
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

/**
 * Acting on a single message: edit, withdraw, pin.
 *
 * The service behind these was written, tested and then never mounted, so the
 * long-press menu offered four actions that every one of them answered 404. The
 * paths here are the ones the clients already call.
 */
router.get("/:id/messages/pinned", authenticate, withId, listPinnedController);

router.patch(
  "/:id/messages/:messageId",
  authenticate,
  contentRateLimiter,
  validate({ params: messageParamsSchema, body: editMessageSchema }),
  editMessageController
);

router.delete(
  "/:id/messages/:messageId",
  authenticate,
  validate({ params: messageParamsSchema, query: deleteMessageQuerySchema }),
  deleteMessageController
);

router.post(
  "/:id/messages/:messageId/pin",
  authenticate,
  validate({ params: messageParamsSchema }),
  pinMessageController
);

router.delete(
  "/:id/messages/:messageId/pin",
  authenticate,
  validate({ params: messageParamsSchema }),
  unpinMessageController
);

export default router;