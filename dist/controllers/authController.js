"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetPassword = exports.forgotPassword = exports.me = exports.resendVerification = exports.verifyEmail = exports.login = exports.register = void 0;
const authService_1 = require("../services/authService");
const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;
const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const sendValidationErrors = (res, errors) => {
    res.status(400).json({
        message: "Validation failed",
        errors
    });
};
const validatePassword = (password) => {
    if (!isNonEmptyString(password)) {
        return [{ field: "password", message: "Password is required" }];
    }
    const errors = [];
    if (password.length < 8) {
        errors.push({
            field: "password",
            message: "Password must be at least 8 characters long"
        });
    }
    if (password.length > 128) {
        errors.push({
            field: "password",
            message: "Password must be at most 128 characters long"
        });
    }
    return errors;
};
const register = async (req, res, next) => {
    try {
        const { email, password, firstName, lastName, bio } = req.body;
        const errors = [];
        if (!isNonEmptyString(email)) {
            errors.push({ field: "email", message: "Email is required" });
        }
        else if (!isValidEmail(email)) {
            errors.push({ field: "email", message: "Email must be valid" });
        }
        errors.push(...validatePassword(password));
        if (!isNonEmptyString(firstName)) {
            errors.push({ field: "firstName", message: "First name is required" });
        }
        if (!isNonEmptyString(lastName)) {
            errors.push({ field: "lastName", message: "Last name is required" });
        }
        if (errors.length > 0) {
            sendValidationErrors(res, errors);
            return;
        }
        const result = await (0, authService_1.registerUser)({ email, password, firstName, lastName, bio });
        res.status(201).json(result);
    }
    catch (error) {
        next(error);
    }
};
exports.register = register;
const login = async (req, res, next) => {
    try {
        const { email, password } = req.body;
        const errors = [];
        if (!isNonEmptyString(email)) {
            errors.push({ field: "email", message: "Email is required" });
        }
        if (!isNonEmptyString(password)) {
            errors.push({ field: "password", message: "Password is required" });
        }
        if (errors.length > 0) {
            sendValidationErrors(res, errors);
            return;
        }
        const result = await (0, authService_1.loginUser)({ email, password });
        res.status(200).json(result);
    }
    catch (error) {
        next(error);
    }
};
exports.login = login;
const verifyEmail = async (req, res, next) => {
    try {
        const { token } = req.query;
        if (!isNonEmptyString(token)) {
            res.status(400).json({ message: "Verification token is required" });
            return;
        }
        const result = await (0, authService_1.verifyUserEmail)(token);
        res.status(200).json(result);
    }
    catch (error) {
        next(error);
    }
};
exports.verifyEmail = verifyEmail;
const resendVerification = async (req, res, next) => {
    try {
        const { email } = req.body;
        if (!isNonEmptyString(email)) {
            res.status(400).json({ message: "email is required" });
            return;
        }
        const result = await (0, authService_1.resendUserVerificationEmail)(email);
        res.status(200).json(result);
    }
    catch (error) {
        next(error);
    }
};
exports.resendVerification = resendVerification;
const me = async (req, res, next) => {
    try {
        if (!req.user) {
            res.status(401).json({ message: "Authentication required" });
            return;
        }
        const user = await (0, authService_1.getCurrentUser)(req.user.id);
        res.status(200).json({ user });
    }
    catch (error) {
        next(error);
    }
};
exports.me = me;
const forgotPassword = async (req, res, next) => {
    try {
        const { email } = req.body;
        const errors = [];
        if (!isNonEmptyString(email)) {
            errors.push({ field: "email", message: "Email is required" });
        }
        else if (!isValidEmail(email)) {
            errors.push({ field: "email", message: "Email must be valid" });
        }
        if (errors.length > 0) {
            sendValidationErrors(res, errors);
            return;
        }
        await (0, authService_1.requestPasswordReset)(email);
        res.status(200).json({
            message: "If an account exists for this email, a reset link has been sent."
        });
    }
    catch (error) {
        next(error);
    }
};
exports.forgotPassword = forgotPassword;
const resetPassword = async (req, res, next) => {
    try {
        const { token, password } = req.body;
        const errors = [];
        if (!isNonEmptyString(token)) {
            errors.push({ field: "token", message: "Token is required" });
        }
        errors.push(...validatePassword(password));
        if (errors.length > 0) {
            sendValidationErrors(res, errors);
            return;
        }
        await (0, authService_1.resetPasswordService)(token, password);
        res.status(200).json({
            message: "Password has been reset successfully"
        });
    }
    catch (error) {
        next(error);
    }
};
exports.resetPassword = resetPassword;
//# sourceMappingURL=authController.js.map