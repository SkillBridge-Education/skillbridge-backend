import { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { authenticate } from "../middleware/authMiddleware";
import { validate } from "../middleware/validate";
import { getAuthenticatedUserId } from "../utils/requestHelpers";
import {
  createTeacherInvite,
  findOrganizationByJoinCode,
  getJoinCodeForMember,
  joinWithCode,
  listTeacherInvites,
  revokeTeacherInvite,
  setInviteDelegation,
} from "../services/joinCodeService";

const handle =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await fn(req, res);
    } catch (error) {
      next(error);
    }
  };

/**
 * Codes are short numbers, so the only thing standing between an attacker and a
 * school is how many guesses they get. Ten attempts an hour makes a
 * million-wide space take centuries.
 */
const codeAttemptLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ message: "Too many code attempts. Please try again later." });
  },
});

const digits = (length: number) =>
  z.string().trim().regex(new RegExp(`^\\d{${length}}$`), `Enter the ${length} digits`);

const router = Router();

router.use(authenticate);

/** Confirms a code matches a real school, so the client can name it before joining. */
router.post(
  "/lookup",
  codeAttemptLimiter,
  validate({ body: z.object({ joinCode: digits(6) }) }),
  handle(async (req, res) => {
    const organization = await findOrganizationByJoinCode(req.body.joinCode as string);
    // Deliberately omits the code itself and anything internal.
    res.status(200).json({ organization: { id: organization.id, name: organization.name } });
  })
);

/**
 * Joins the school. Without a teacher code the caller becomes a student with no
 * powers; with one, a teacher.
 */
router.post(
  "/join",
  codeAttemptLimiter,
  validate({
    body: z.object({
      joinCode: digits(6),
      teacherCode: digits(8).optional(),
    }),
  }),
  handle(async (req, res) => {
    const membership = await joinWithCode({
      userId: getAuthenticatedUserId(req),
      joinCode: req.body.joinCode as string,
      teacherCode: req.body.teacherCode as string | undefined,
    });
    res.status(201).json({ membership });
  })
);

/** Staff only — a student must never see the code. */
router.get(
  "/code",
  handle(async (req, res) => {
    const details = await getJoinCodeForMember(getAuthenticatedUserId(req));
    res.status(200).json(details);
  })
);

// --- Teacher invites -------------------------------------------------------

router.get(
  "/invites",
  handle(async (req, res) => {
    const invites = await listTeacherInvites(getAuthenticatedUserId(req));
    res.status(200).json({ invites });
  })
);

router.post(
  "/invites",
  validate({ body: z.object({ note: z.string().trim().max(120).optional() }) }),
  handle(async (req, res) => {
    const invite = await createTeacherInvite(
      getAuthenticatedUserId(req),
      req.body.note as string | undefined
    );
    res.status(201).json({ invite });
  })
);

router.delete(
  "/invites/:id",
  validate({ params: z.object({ id: z.string().uuid() }) }),
  handle(async (req, res) => {
    const invite = await revokeTeacherInvite(getAuthenticatedUserId(req), req.params.id as string);
    res.status(200).json({ invite });
  })
);

/** Delegates the power to mint invites; only the school administrator may do it. */
router.patch(
  "/invites/delegation/:userId",
  validate({
    params: z.object({ userId: z.string().uuid() }),
    body: z.object({ canInviteTeachers: z.boolean() }),
  }),
  handle(async (req, res) => {
    await setInviteDelegation(
      getAuthenticatedUserId(req),
      req.params.userId as string,
      req.body.canInviteTeachers as boolean
    );
    res.status(204).send();
  })
);

export default router;
