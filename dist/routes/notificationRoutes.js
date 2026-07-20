"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const authMiddleware_1 = require("../middleware/authMiddleware");
const notificationController_1 = require("../controllers/notificationController");
const router = (0, express_1.Router)();
router.post("/", authMiddleware_1.authenticate, notificationController_1.createNotificationController);
router.get("/", authMiddleware_1.authenticate, notificationController_1.getNotificationsController);
router.patch("/:id/read", authMiddleware_1.authenticate, notificationController_1.markNotificationAsReadController);
exports.default = router;
//# sourceMappingURL=notificationRoutes.js.map