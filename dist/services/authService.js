"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetPasswordService = exports.requestPasswordReset = exports.resendUserVerificationEmail = exports.verifyUserEmail = exports.getCurrentUser = exports.loginUser = exports.registerUser = void 0;
const crypto_1 = require("crypto");
const client_1 = require("@prisma/client");
const prisma_1 = require("../utils/prisma");
const jwt_1 = require("../utils/jwt");
const httpError_1 = require("../utils/httpError");
const password_1 = require("../utils/password");
const env_1 = require("../utils/env");
const emailVerificationService_1 = require("./emailVerificationService");
const emailService_1 = require("./emailService");
const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const INVALID_RESET_TOKEN_MESSAGE = "Invalid or expired password reset token";
const hashResetToken = (token) => (0, crypto_1.createHash)("sha256").update(token).digest("hex");
const sanitizeUser = (user) => ({
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    bio: user.bio,
    role: user.role,
    status: user.status,
    isEmailVerified: user.isEmailVerified,
    credits: user.credits,
    averageRating: user.averageRating,
    totalRatings: user.totalRatings,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
});
const registerUser = async (input) => {
    const normalizedEmail = input.email.trim().toLowerCase();
    const existingUser = await prisma_1.prisma.user.findUnique({
        where: { email: normalizedEmail },
    });
    if (existingUser) {
        throw new httpError_1.HttpError(409, "Email is already registered");
    }
    const passwordHash = await (0, password_1.hashPassword)(input.password);
    const user = await prisma_1.prisma.user.create({
        data: {
            email: normalizedEmail,
            passwordHash,
            firstName: input.firstName.trim(),
            lastName: input.lastName.trim(),
            bio: input.bio?.trim(),
            role: client_1.Role.USER,
            isEmailVerified: false,
        },
    });
    // Always send the verification email (fire-and-forget so it never blocks registration)
    (0, emailVerificationService_1.sendUserVerificationEmail)(user).catch((err) => {
        console.error("Failed to send verification email", err);
    });
    if (!env_1.env.requireEmailVerification) {
        // Historic behaviour: return a token for immediate auto-login
        const token = (0, jwt_1.generateToken)({ userId: user.id, role: user.role });
        return { user: sanitizeUser(user), token };
    }
    return {
        user: sanitizeUser(user),
        message: "Registration successful. Please verify your email address before signing in.",
    };
};
exports.registerUser = registerUser;
const loginUser = async (input) => {
    const normalizedEmail = input.email.trim().toLowerCase();
    const user = await prisma_1.prisma.user.findUnique({
        where: { email: normalizedEmail },
    });
    if (!user || user.status !== client_1.UserStatus.ACTIVE) {
        throw new httpError_1.HttpError(401, "Invalid email or password");
    }
    const isPasswordValid = await (0, password_1.comparePassword)(input.password, user.passwordHash);
    if (!isPasswordValid) {
        throw new httpError_1.HttpError(401, "Invalid email or password");
    }
    if (env_1.env.requireEmailVerification && !user.isEmailVerified) {
        throw new httpError_1.HttpError(403, "Please verify your email address before signing in.");
    }
    const token = (0, jwt_1.generateToken)({ userId: user.id, role: user.role });
    return { user: sanitizeUser(user), token };
};
exports.loginUser = loginUser;
const getCurrentUser = async (userId) => {
    const user = await prisma_1.prisma.user.findUnique({
        where: { id: userId },
    });
    if (!user || user.status !== client_1.UserStatus.ACTIVE) {
        throw new httpError_1.HttpError(404, "User not found");
    }
    if (env_1.env.requireEmailVerification && !user.isEmailVerified) {
        throw new httpError_1.HttpError(403, "Please verify your email address before signing in.");
    }
    return sanitizeUser(user);
};
exports.getCurrentUser = getCurrentUser;
const verifyUserEmail = async (token) => {
    const user = await (0, emailVerificationService_1.verifyEmailToken)(token);
    return {
        user: sanitizeUser(user),
        message: "Email address verified successfully.",
    };
};
exports.verifyUserEmail = verifyUserEmail;
const resendUserVerificationEmail = async (email) => {
    await (0, emailVerificationService_1.resendEmailVerification)(email);
    return {
        message: "If an unverified account exists for this email, a new verification link has been sent.",
    };
};
exports.resendUserVerificationEmail = resendUserVerificationEmail;
const requestPasswordReset = async (email) => {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await prisma_1.prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true, email: true, status: true },
    });
    if (!user || user.status !== client_1.UserStatus.ACTIVE) {
        return;
    }
    const token = (0, crypto_1.randomBytes)(32).toString("hex");
    const tokenHash = hashResetToken(token);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TOKEN_TTL_MS);
    await prisma_1.prisma.$transaction([
        prisma_1.prisma.passwordResetToken.updateMany({
            where: { userId: user.id, usedAt: null },
            data: { usedAt: now },
        }),
        prisma_1.prisma.passwordResetToken.create({
            data: { userId: user.id, tokenHash, expiresAt },
        }),
    ]);
    const resetUrl = new URL(`${env_1.env.frontendUrl}/reset-password`);
    resetUrl.searchParams.set("token", token);
    try {
        await (0, emailService_1.sendPasswordResetEmail)({ to: user.email, resetUrl: resetUrl.toString() });
    }
    catch (error) {
        console.error("Failed to send password reset email", error);
    }
};
exports.requestPasswordReset = requestPasswordReset;
const resetPasswordService = async (token, password) => {
    const tokenHash = hashResetToken(token);
    const resetToken = await prisma_1.prisma.passwordResetToken.findUnique({
        where: { tokenHash },
        select: { id: true, userId: true, expiresAt: true, usedAt: true },
    });
    const now = new Date();
    if (!resetToken ||
        resetToken.usedAt ||
        resetToken.expiresAt.getTime() <= now.getTime()) {
        throw new httpError_1.HttpError(400, INVALID_RESET_TOKEN_MESSAGE);
    }
    const passwordHash = await (0, password_1.hashPassword)(password);
    await prisma_1.prisma.$transaction(async (transaction) => {
        const consumed = await transaction.passwordResetToken.updateMany({
            where: { id: resetToken.id, usedAt: null, expiresAt: { gt: now } },
            data: { usedAt: now },
        });
        if (consumed.count !== 1) {
            throw new httpError_1.HttpError(400, INVALID_RESET_TOKEN_MESSAGE);
        }
        await transaction.user.update({
            where: { id: resetToken.userId },
            data: { passwordHash },
        });
        await transaction.passwordResetToken.updateMany({
            where: { userId: resetToken.userId, usedAt: null },
            data: { usedAt: now },
        });
    });
};
exports.resetPasswordService = resetPasswordService;
//# sourceMappingURL=authService.js.map