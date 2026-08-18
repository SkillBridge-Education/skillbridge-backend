import { Router } from "express";
import { NextFunction, Request, Response } from "express";
import { authenticate, authenticateAllowingSuspended } from "../middleware/authMiddleware";
import { validate } from "../middleware/validate";
import { contentRateLimiter, reportRateLimiter } from "../middleware/rateLimit";
import { getAuthenticatedUserId } from "../utils/requestHelpers";
import {
  blockUser,
  createAppeal,
  createReport,
  listBlockedUsers,
  listMyAppeals,
  listMyReports,
  requestOrganization,
  unblockUser,
} from "../services/moderationService";
import {
  createAppealSchema,
  createReportSchema,
  requestOrganizationSchema,
  userIdParamSchema,
} from "../schemas/moderationSchemas";

const handle =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await fn(req, res);
    } catch (error) {
      next(error);
    }
  };

const router = Router();

// --- Reports ---------------------------------------------------------------
// Rate limited to 10/hour: a report is a serious act, and throttling them is
// one of the defences against a coordinated reporting campaign.
router.post(
  "/reports",
  authenticate,
  reportRateLimiter,
  validate({ body: createReportSchema }),
  handle(async (req, res) => {
    const report = await createReport({
      reporterId: getAuthenticatedUserId(req),
      ...req.body,
    });
    res.status(201).json({ report });
  })
);

router.get(
  "/reports/mine",
  authenticate,
  handle(async (req, res) => {
    const reports = await listMyReports(getAuthenticatedUserId(req));
    res.status(200).json({ reports });
  })
);

// --- Blocking --------------------------------------------------------------
// A personal preference rather than a sanction, so no reason and no review.
router.post(
  "/blocks/:id",
  authenticate,
  validate({ params: userIdParamSchema }),
  handle(async (req, res) => {
    const block = await blockUser(getAuthenticatedUserId(req), req.params.id as string);
    res.status(201).json({ block });
  })
);

router.delete(
  "/blocks/:id",
  authenticate,
  validate({ params: userIdParamSchema }),
  handle(async (req, res) => {
    await unblockUser(getAuthenticatedUserId(req), req.params.id as string);
    res.status(204).send();
  })
);

router.get(
  "/blocks",
  authenticate,
  handle(async (req, res) => {
    const blocks = await listBlockedUsers(getAuthenticatedUserId(req));
    res.status(200).json({ blocks });
  })
);

// --- Appeals ---------------------------------------------------------------
// Uses the middleware that lets suspended accounts through: an appeal a
// suspended user cannot reach is not an appeal.
router.post(
  "/appeals",
  authenticateAllowingSuspended,
  contentRateLimiter,
  validate({ body: createAppealSchema }),
  handle(async (req, res) => {
    const appeal = await createAppeal(
      getAuthenticatedUserId(req),
      req.body.message as string
    );
    res.status(201).json({ appeal });
  })
);

router.get(
  "/appeals/mine",
  authenticateAllowingSuspended,
  handle(async (req, res) => {
    const appeals = await listMyAppeals(getAuthenticatedUserId(req));
    res.status(200).json({ appeals });
  })
);

// --- School registration ---------------------------------------------------
// Deliberately unauthenticated: a school applies before anyone there has an
// account. It only ever creates a PENDING request that an admin must approve.
router.post(
  "/organizations/requests",
  contentRateLimiter,
  validate({ body: requestOrganizationSchema }),
  handle(async (req, res) => {
    const organization = await requestOrganization(req.body);
    res.status(201).json({ organization });
  })
);

export default router;
