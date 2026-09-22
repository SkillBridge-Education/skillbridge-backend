import { Router } from "express";
import authRoutes from "./authRoutes";
import healthRoutes from "./healthRoutes";
import matchRoutes from "./matchRoutes";
import userRoutes from "./userRoutes";
import sessionRoutes from "./sessionRoutes";
import conversationRoutes from "./conversationRoutes";
import creditRoutes from "./creditRoutes";
import adminRoutes from "./adminRoutes";
import { adminAuthRouter } from "./adminRoutes";
import moderationRoutes from "./moderationRoutes";
import organizationRoutes from "./organizationRoutes";
import statsRoutes from "./statsRoutes";
import joinCodeRoutes from "./joinCodeRoutes";
import establishmentRoutes from "./establishmentRoutes";
import campusLifeRoutes from "./campusLifeRoutes";
import uploadRoutes from "./uploadRoutes";
import favoriteRoutes from "./favoriteRoutes";
import { adminSupportRouter, supportRouter } from "./supportRoutes";
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
router.use("/admin/auth", adminAuthRouter);
router.use("/admin/support", adminSupportRouter);
router.use("/admin", adminRoutes);
router.use("/", moderationRoutes);
// Registered before the broader /school router: this one owns "/apply",
// "/my-application" and "/access-codes", and a prefix collision would silently
// hand those paths to whichever router was mounted first.
router.use("/school", establishmentRoutes);
// Cours et evenements : l'etablissement est toujours lu depuis l'adhesion du
// demandeur, jamais recu du client.
router.use("/school", campusLifeRoutes);
router.use("/school", organizationRoutes);
router.use("/stats", statsRoutes);
// Mounted under its own prefix rather than /school: both routers define a
// "/join", and the first one registered would silently win — the code-based
// join would have been unreachable.
router.use("/school/codes", joinCodeRoutes);
router.use("/uploads", uploadRoutes);
router.use("/favorites", favoriteRoutes);
router.use("/support", supportRouter);

export default router;
