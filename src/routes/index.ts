import { Router } from "express";
import authRoutes from "./authRoutes";
import healthRoutes from "./healthRoutes";
import matchRoutes from "./matchRoutes";
import userRoutes from "./userRoutes";
import sessionRoutes from "./sessionRoutes";
import conversationRoutes from "./conversationRoutes";
import creditRoutes from "./creditRoutes";
import adminRoutes from "./adminRoutes";
import moderationRoutes from "./moderationRoutes";
import organizationRoutes from "./organizationRoutes";
import notificationRoutes from "./notificationRoutes";

const router = Router();

// Mount feature route files here. Example: router.use("/users", userRoutes);
router.use("/", healthRoutes);
router.use("/notifications", notificationRoutes);
router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/matches", matchRoutes);
router.use("/conversations", conversationRoutes);
router.use("/sessions", sessionRoutes);
router.use("/credits", creditRoutes);
router.use("/admin", adminRoutes);
router.use("/", moderationRoutes);
router.use("/school", organizationRoutes);

export default router;
