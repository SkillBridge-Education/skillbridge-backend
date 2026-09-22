import { Router } from "express";
import { authenticate } from "../middleware/authMiddleware";
import { validate } from "../middleware/validate";
import {
  createNotificationSchema,
  notificationIdParamSchema,
} from "../schemas/notificationSchemas";
import {
  createNotificationController,
  getNotificationsController,
  markNotificationAsReadController,
} from "../controllers/notificationController";

const router = Router();

router.post(
  "/",
  authenticate,
  validate({ body: createNotificationSchema }),
  createNotificationController
);
router.get("/", authenticate, getNotificationsController);
router.patch(
  "/:id/read",
  authenticate,
  validate({ params: notificationIdParamSchema }),
  markNotificationAsReadController
);

export default router;