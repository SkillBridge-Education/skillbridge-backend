import { NextFunction, Request, Response } from "express";
import { Role, UserStatus } from "@prisma/client";
import { verifyToken } from "../utils/jwt";
import { prisma } from "../utils/prisma";
import { env } from "../utils/env";

type AuthenticatedUser = {
  id: string;
  role: Role;
  status: UserStatus;
  isEmailVerified: boolean;
  suspensionReason: string | null;
};

/**
 * Resolves the bearer token to the *current* database record. The role and
 * status deliberately come from the database rather than the token, so a
 * revoked role or a suspension takes effect immediately instead of lingering
 * until the token expires.
 */
const resolveUserFromRequest = async (
  req: Request
): Promise<AuthenticatedUser | null> => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const payload = verifyToken(authHeader.split(" ")[1]);

  return prisma.user.findUnique({
    where: { id: payload.userId },
    select: {
      id: true,
      role: true,
      status: true,
      isEmailVerified: true,
      suspensionReason: true
    }
  });
};

export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const user = await resolveUserFromRequest(req);

    if (!user) {
      res.status(401).json({ message: "Authorization token is required" });
      return;
    }

    // A suspended user is told why and pointed at the appeal route. Returning
    // "invalid token" here would be both misleading and, under the DSA, a
    // failure to give a statement of reasons.
    if (user.status === UserStatus.SUSPENDED) {
      res.status(403).json({
        message: "Your account is suspended.",
        reason: user.suspensionReason,
        appealPath: "/appeals"
      });
      return;
    }

    if (user.status !== UserStatus.ACTIVE) {
      res.status(401).json({ message: "Invalid or expired token" });
      return;
    }

    if (env.requireEmailVerification && !user.isEmailVerified) {
      res.status(403).json({ message: "Please verify your email address before signing in." });
      return;
    }

    // Store the verified identity on the request for controllers that need the current user.
    req.user = {
      id: user.id,
      role: user.role
    };

    next();
  } catch {
    res.status(401).json({ message: "Invalid or expired token" });
  }
};

/**
 * Authentication for the appeal route only. Suspended users must be able to
 * reach it — an appeal they cannot submit is not an appeal — but they must not
 * reach anything else.
 */
export const authenticateAllowingSuspended = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const user = await resolveUserFromRequest(req);

    if (!user || user.status === UserStatus.DELETED) {
      res.status(401).json({ message: "Invalid or expired token" });
      return;
    }

    req.user = { id: user.id, role: user.role };
    next();
  } catch {
    res.status(401).json({ message: "Invalid or expired token" });
  }
};

export const authorizeRoles =
  (...roles: Role[]) =>
  (req: Request, res: Response, next: NextFunction): void => {
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
