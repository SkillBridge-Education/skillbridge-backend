"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authorizeRoles = exports.authenticate = void 0;
const client_1 = require("@prisma/client");
const jwt_1 = require("../utils/jwt");
const prisma_1 = require("../utils/prisma");
const env_1 = require("../utils/env");
const authenticate = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
        res.status(401).json({ message: "Authorization token is required" });
        return;
    }
    const token = authHeader.split(" ")[1];
    try {
        const payload = (0, jwt_1.verifyToken)(token);
        const user = await prisma_1.prisma.user.findUnique({
            where: { id: payload.userId },
            select: {
                id: true,
                role: true,
                status: true,
                isEmailVerified: true
            }
        });
        if (!user || user.status !== client_1.UserStatus.ACTIVE) {
            res.status(401).json({ message: "Invalid or expired token" });
            return;
        }
        if (env_1.env.requireEmailVerification && !user.isEmailVerified) {
            res.status(403).json({ message: "Please verify your email address before signing in." });
            return;
        }
        // Store the verified identity on the request for controllers that need the current user.
        req.user = {
            id: user.id,
            role: user.role
        };
        next();
    }
    catch {
        res.status(401).json({ message: "Invalid or expired token" });
    }
};
exports.authenticate = authenticate;
const authorizeRoles = (...roles) => (req, res, next) => {
    if (!req.user) {
        res.status(401).json({ message: "Authentication required" });
        return;
    }
    if (!roles.includes(req.user.role)) {
        res.status(403).json({ message: "You do not have permission to access this resource" });
        return;
    }
    next();
};
exports.authorizeRoles = authorizeRoles;
//# sourceMappingURL=authMiddleware.js.map