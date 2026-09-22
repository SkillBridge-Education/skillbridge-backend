import { NextFunction, Request, Response } from "express";
import { getAuthenticatedUserId } from "../utils/requestHelpers";
import * as adminService from "../services/adminService";

/** Wraps a handler so each one does not repeat the same try/catch. */
const handle =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await fn(req, res);
    } catch (error) {
      next(error);
    }
  };

// --- Users -----------------------------------------------------------------

export const listUsersController = handle(async (req, res) => {
  const { search, status, limit, cursor } = req.query as never;
  const page = await adminService.listUsers({ search, status, limit, cursor });

  res.status(200).json({ users: page.items, nextCursor: page.nextCursor, hasMore: page.hasMore });
});

export const getUserController = handle(async (req, res) => {
  const user = await adminService.getUserForAdmin(req.params.id as string);
  res.status(200).json({ user });
});

export const banUserController = handle(async (req, res) => {
  const user = await adminService.banUser(
    getAuthenticatedUserId(req),
    req.params.id as string,
    req.body.reason as string
  );
  res.status(200).json({ user });
});

export const unbanUserController = handle(async (req, res) => {
  const user = await adminService.unbanUser(
    getAuthenticatedUserId(req),
    req.params.id as string,
    req.body.reason as string
  );
  res.status(200).json({ user });
});

export const adjustCreditsController = handle(async (req, res) => {
  const { user, transaction } = await adminService.adjustCredits(
    getAuthenticatedUserId(req),
    req.params.id as string,
    req.body.amount as number,
    req.body.reason as string
  );
  res.status(200).json({ user, transaction });
});

// --- Reports ---------------------------------------------------------------

export const listReportsController = handle(async (req, res) => {
  const { status, limit, cursor } = req.query as never;
  const page = await adminService.listReports({ status, limit, cursor });

  res.status(200).json({ reports: page.items, nextCursor: page.nextCursor, hasMore: page.hasMore });
});

export const actionReportController = handle(async (req, res) => {
  const report = await adminService.actionReport(
    getAuthenticatedUserId(req),
    req.params.id as string,
    req.body.reason as string
  );
  res.status(200).json({ report });
});

export const dismissReportController = handle(async (req, res) => {
  const report = await adminService.dismissReport(
    getAuthenticatedUserId(req),
    req.params.id as string,
    req.body.reason as string
  );
  res.status(200).json({ report });
});

// --- Organizations ---------------------------------------------------------

export const listOrganizationsController = handle(async (req, res) => {
  const { status, limit, cursor } = req.query as never;
  const page = await adminService.listOrganizations({ status, limit, cursor });

  res
    .status(200)
    .json({ organizations: page.items, nextCursor: page.nextCursor, hasMore: page.hasMore });
});

export const approveOrganizationController = handle(async (req, res) => {
  const organization = await adminService.approveOrganization(
    getAuthenticatedUserId(req),
    req.params.id as string,
    req.body.reason as string
  );
  res.status(200).json({ organization });
});

export const rejectOrganizationController = handle(async (req, res) => {
  const organization = await adminService.rejectOrganization(
    getAuthenticatedUserId(req),
    req.params.id as string,
    req.body.reason as string
  );
  res.status(200).json({ organization });
});

// --- Appeals ---------------------------------------------------------------

export const listAppealsController = handle(async (req, res) => {
  const { status, limit, cursor } = req.query as never;
  const page = await adminService.listAppeals({ status, limit, cursor });

  res.status(200).json({ appeals: page.items, nextCursor: page.nextCursor, hasMore: page.hasMore });
});

export const reviewAppealController = handle(async (req, res) => {
  const appeal = await adminService.reviewAppeal(
    getAuthenticatedUserId(req),
    req.params.id as string,
    req.body.decision as "GRANTED" | "DENIED",
    req.body.response as string
  );
  res.status(200).json({ appeal });
});

// --- Audit and stats -------------------------------------------------------

export const listAuditController = handle(async (req, res) => {
  const { action, actorId, limit, cursor } = req.query as never;
  const page = await adminService.listAuditLog({ action, actorId, limit, cursor });

  res.status(200).json({ entries: page.items, nextCursor: page.nextCursor, hasMore: page.hasMore });
});

export const getStatsController = handle(async (_req, res) => {
  const stats = await adminService.getPlatformStats();
  res.status(200).json({ stats });
});
