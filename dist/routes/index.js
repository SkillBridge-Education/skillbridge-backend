"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const authRoutes_1 = __importDefault(require("./authRoutes"));
const healthRoutes_1 = __importDefault(require("./healthRoutes"));
const matchRoutes_1 = __importDefault(require("./matchRoutes"));
const userRoutes_1 = __importDefault(require("./userRoutes"));
const sessionRoutes_1 = __importDefault(require("./sessionRoutes"));
const conversationRoutes_1 = __importDefault(require("./conversationRoutes"));
const creditRoutes_1 = __importDefault(require("./creditRoutes"));
const notificationRoutes_1 = __importDefault(require("./notificationRoutes"));
const router = (0, express_1.Router)();
// Mount feature route files here. Example: router.use("/users", userRoutes);
router.use("/", healthRoutes_1.default);
router.use("/notifications", notificationRoutes_1.default);
router.use("/auth", authRoutes_1.default);
router.use("/users", userRoutes_1.default);
router.use("/matches", matchRoutes_1.default);
router.use("/conversations", conversationRoutes_1.default);
router.use("/sessions", sessionRoutes_1.default);
router.use("/credits", creditRoutes_1.default);
exports.default = router;
//# sourceMappingURL=index.js.map