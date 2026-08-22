import { NextFunction, Request, Response, Router } from "express";
import { Role } from "@prisma/client";
import { authenticate, authorizeRoles } from "../middleware/authMiddleware";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { authRateLimiter } from "../middleware/authRateLimit";
import { getAuthenticatedUserId } from "../utils/requestHelpers";
import { adminLogin, getAdminProfile } from "../services/adminAuthService";
import { getDashboardStats, getTimeseries } from "../services/dashboardStatsService";
import { getSettings, updateSettings } from "../services/settingsService";
import { recordSettingsChange } from "../services/adminService";
import {
  actionReportController,
  adjustCreditsController,
  approveOrganizationController,
  banUserController,
  dismissReportController,
  getStatsController,
  getUserController,
  listAppealsController,
  listAuditController,
  listOrganizationsController,
  listReportsController,
  listUsersController,
  rejectOrganizationController,
  reviewAppealController,
  unbanUserController,
} from "../controllers/adminController";
import {
  adjustCreditsSchema,
  idParamSchema,
  listAppealsQuerySchema,
  listAuditQuerySchema,
  listOrganizationsQuerySchema,
  listReportsQuerySchema,
  listUsersQuerySchema,
  reasonBodySchema,
  reviewAppealSchema,
} from "../schemas/adminSchemas";

const router = Router();

// Every route below is platform-admin only. authenticate re-reads the role from
// the database on each request, so revoking an admin takes effect immediately
// rather than when their token expires.
router.use(authenticate, authorizeRoles(Role.ADMIN));

const withId = validate({ params: idParamSchema });
const withReason = validate({ params: idParamSchema, body: reasonBodySchema });

// --- Users -----------------------------------------------------------------
router.get("/users", validate({ query: listUsersQuerySchema }), listUsersController);
router.get("/users/:id", withId, getUserController);
router.post("/users/:id/ban", withReason, banUserController);
router.post("/users/:id/unban", withReason, unbanUserController);
router.post(
  "/users/:id/credits",
  validate({ params: idParamSchema, body: adjustCreditsSchema }),
  adjustCreditsController
);

// --- Reports ---------------------------------------------------------------
router.get("/reports", validate({ query: listReportsQuerySchema }), listReportsController);
// "resolve" is what the back-office calls it and what a moderator would say;
// "action" was the internal name. Both are served so neither client breaks.
router.post("/reports/:id/resolve", withReason, actionReportController);
router.post("/reports/:id/action", withReason, actionReportController);
router.post("/reports/:id/dismiss", withReason, dismissReportController);

// --- Organizations ---------------------------------------------------------
router.get(
  "/organizations",
  validate({ query: listOrganizationsQuerySchema }),
  listOrganizationsController
);
router.post("/organizations/:id/approve", withReason, approveOrganizationController);
router.post("/organizations/:id/reject", withReason, rejectOrganizationController);

// --- Appeals ---------------------------------------------------------------
router.get("/appeals", validate({ query: listAppealsQuerySchema }), listAppealsController);
router.post(
  "/appeals/:id/review",
  validate({ params: idParamSchema, body: reviewAppealSchema }),
  reviewAppealController
);

// --- Audit and stats -------------------------------------------------------
// Read only: there is deliberately no route that writes, edits or deletes an
// audit entry. A trail that can be rewritten proves nothing.
router.get("/audit", validate({ query: listAuditQuerySchema }), listAuditController);
router.get(
  "/stats",
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.status(200).json({ stats: await getDashboardStats() });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/stats/traffic",
  validate({ query: z.object({ days: z.coerce.number().int().min(1).max(90).default(30) }) }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const traffic = await getTimeseries((req.query as unknown as { days: number }).days);
      res.status(200).json({ traffic });
    } catch (error) {
      next(error);
    }
  }
);

export default router;

// --- Back-office sign-in ---------------------------------------------------

/**
 * Registered before the admin guard: signing in is how one becomes an admin,
 * so it cannot itself require being one.
 */
export const adminAuthRouter = Router();

adminAuthRouter.post(
  "/login",
  authRateLimiter,
  validate({
    body: z.object({
      email: z.string().trim().email("A valid email is required"),
      password: z.string().min(1, "Password is required"),
    }),
  }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await adminLogin(req.body.email as string, req.body.password as string);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * The dashboard has a second-factor step. There is no TOTP secret stored and
 * nothing to verify against, so accepting a code here would be theatre — it
 * would report success on any six digits. It refuses instead, and says why.
 */
adminAuthRouter.post("/mfa", (_req: Request, res: Response): void => {
  res.status(501).json({
    message:
      "Two-factor authentication is not configured yet. Sign-in completes at the password step.",
    mfaEnabled: false,
  });
});

adminAuthRouter.post("/logout", (_req: Request, res: Response): void => {
  // Stateless tokens: signing out is the client discarding it. Present so the
  // dashboard has something to call, and so the intent is recorded here.
  res.status(204).send();
});

adminAuthRouter.get(
  "/me",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const admin = await getAdminProfile(getAuthenticatedUserId(req));
      res.status(200).json({ admin });
    } catch (error) {
      next(error);
    }
  }
);

// --- Platform settings -----------------------------------------------------

/**
 * Changing a setting is a privileged act with real consequences — lowering the
 * cost of a session is handing out value — so it carries a mandatory reason and
 * lands in the audit trail like every other admin action.
 */
router.get(
  "/settings",
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.status(200).json({ settings: await getSettings() });
    } catch (error) {
      next(error);
    }
  }
);

router.patch(
  "/settings",
  validate({
    body: z
      .object({
        signupCredits: z.number().int().optional(),
        creditsPerSessionHour: z.number().int().optional(),
        minimumAge: z.number().int().optional(),
        registrationOpen: z.boolean().optional(),
        requireOrganizationApproval: z.boolean().optional(),
        maintenanceMode: z.boolean().optional(),
        autoSuspendThreshold: z.number().int().optional(),
        supportEmail: z.string().trim().email().max(200).optional(),
        reason: z.string().trim().min(10, "A reason of at least 10 characters is required").max(500),
      })
      .refine(
        (body) => Object.keys(body).some((key) => key !== "reason"),
        "At least one setting must be provided"
      ),
  }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { reason, ...patch } = req.body as { reason: string } & Record<string, unknown>;
      const actorId = getAuthenticatedUserId(req);

      const settings = await updateSettings(actorId, patch);

      await recordSettingsChange(actorId, reason, patch);

      res.status(200).json({ settings });
    } catch (error) {
      next(error);
    }
  }
);
