"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const authController_1 = require("../controllers/authController");
const authMiddleware_1 = require("../middleware/authMiddleware");
const authRateLimit_1 = require("../middleware/authRateLimit");
const router = (0, express_1.Router)();
router.use(["/register", "/login", "/forgot-password", "/reset-password"], authRateLimit_1.authRateLimiter);
router.post("/register", authController_1.register);
router.post("/login", authController_1.login);
router.post("/forgot-password", authController_1.forgotPassword);
router.post("/reset-password", authController_1.resetPassword);
router.get("/verify-email", authController_1.verifyEmail);
router.post("/resend-verification", authController_1.resendVerification);
router.get("/me", authMiddleware_1.authenticate, authController_1.me);
exports.default = router;
//# sourceMappingURL=authRoutes.js.map