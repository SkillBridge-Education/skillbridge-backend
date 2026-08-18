import { NextFunction, Request, Response, Router } from "express";
import { OrgRole, TeachingSessionStatus } from "@prisma/client";
import { z } from "zod";
import { authenticate } from "../middleware/authMiddleware";
import { validate } from "../middleware/validate";
import { getAuthenticatedUserId } from "../utils/requestHelpers";
import {
  addMember,
  getActiveMembership,
  getClassSkillGaps,
  getStudentProgress,
  getStudentsAtRisk,
  getTeacherAgenda,
  listMembers,
  removeMember,
  verifyStudentSkill,
} from "../services/organizationService";

const handle =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await fn(req, res);
    } catch (error) {
      next(error);
    }
  };

const idParam = z.object({ id: z.string().uuid("A valid id is required") });

const router = Router();

// Every route needs a signed-in user; the school scoping happens in the service
// layer, which reads the caller's own membership rather than trusting the body.
router.use(authenticate);

/**
 * Tells a client which mode it is in. An account with no active membership is
 * an individual account, which is what separates the normal app from the
 * school app.
 */
router.get(
  "/me/membership",
  handle(async (req, res) => {
    const membership = await getActiveMembership(getAuthenticatedUserId(req));
    res.status(200).json({ membership, mode: membership ? "SCHOOL" : "INDIVIDUAL" });
  })
);

// --- Members ---------------------------------------------------------------

router.get(
  "/members",
  validate({
    query: z.object({
      orgRole: z.nativeEnum(OrgRole).optional(),
      limit: z.coerce.number().int().positive().max(200).default(100),
    }),
  }),
  handle(async (req, res) => {
    const { orgRole, limit } = req.query as never;
    const members = await listMembers(getAuthenticatedUserId(req), { orgRole, limit });
    res.status(200).json({ members });
  })
);

router.post(
  "/members",
  validate({
    body: z.object({
      userId: z.string().uuid("A valid user id is required"),
      orgRole: z.nativeEnum(OrgRole).default(OrgRole.STUDENT),
    }),
  }),
  handle(async (req, res) => {
    const membership = await addMember(
      getAuthenticatedUserId(req),
      req.body.userId as string,
      req.body.orgRole as OrgRole
    );
    res.status(201).json({ membership });
  })
);

router.delete(
  "/members/:id",
  validate({ params: idParam }),
  handle(async (req, res) => {
    await removeMember(getAuthenticatedUserId(req), req.params.id as string);
    res.status(204).send();
  })
);

// --- Teacher dashboard -----------------------------------------------------

router.get(
  "/teacher/agenda",
  validate({
    query: z.object({
      status: z.nativeEnum(TeachingSessionStatus).optional(),
      limit: z.coerce.number().int().positive().max(100).default(50),
    }),
  }),
  handle(async (req, res) => {
    const { status, limit } = req.query as never;
    const sessions = await getTeacherAgenda(getAuthenticatedUserId(req), { status, limit });
    res.status(200).json({ sessions });
  })
);

router.get(
  "/teacher/students",
  handle(async (req, res) => {
    const students = await getStudentProgress(getAuthenticatedUserId(req));
    res.status(200).json({ students });
  })
);

router.get(
  "/teacher/students/at-risk",
  handle(async (req, res) => {
    const students = await getStudentsAtRisk(getAuthenticatedUserId(req));
    res.status(200).json({ students });
  })
);

router.get(
  "/teacher/skill-gaps",
  handle(async (req, res) => {
    const gaps = await getClassSkillGaps(getAuthenticatedUserId(req));
    res.status(200).json({ gaps });
  })
);

// Writes UserSkill.isVerified, which nothing wrote before: this is what makes
// "verified by the school" mean something.
router.patch(
  "/teacher/skills/:id/verify",
  validate({ params: idParam, body: z.object({ verified: z.boolean() }) }),
  handle(async (req, res) => {
    const skill = await verifyStudentSkill(
      getAuthenticatedUserId(req),
      req.params.id as string,
      req.body.verified as boolean
    );
    res.status(200).json({ skill });
  })
);

export default router;
