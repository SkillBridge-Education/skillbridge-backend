import { Router } from "express";
import { Role } from "@prisma/client";
import { authenticate, authorizeRoles } from "../middleware/authMiddleware";
import { validate } from "../middleware/validate";
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
router.get("/stats", getStatsController);

export default router;
