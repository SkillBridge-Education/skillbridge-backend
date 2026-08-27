import { Router } from "express";
import {
  createLearningGoal,
  createSkill,
  deleteLearningGoal,
  deleteSkill,
  getById,
  getMe,
  getRatings,
  getRatingSummary,
  search,
  updateMe
} from "../controllers/userController";
import { authenticate } from "../middleware/authMiddleware";
import { deleteAccount, exportUserData } from "../services/privacyService";
import { getAuthenticatedUserId } from "../utils/requestHelpers";
import { validate } from "../middleware/validate";
import { searchRateLimiter } from "../middleware/rateLimit";
import { searchQuerySchema, userIdParamSchema } from "../schemas/userSchemas";

const router = Router();

/**
 * Authenticated, like every other read of a member profile.
 *
 * This used to be open, and the comment here said so: it returned the name,
 * bio, skills, rating *and weekly availability* of every active account to
 * anyone who asked, with no token. A large share of those accounts belong to
 * 15-to-18-year-olds. Scraping a directory of minors, complete with when each
 * of them is free, cannot be the cheapest request on the API.
 */
router.get(
  "/search",
  authenticate,
  searchRateLimiter,
  validate({ query: searchQuerySchema }),
  search
);

// Everything below changes or returns private account data, so it must be protected.
router.get("/me", authenticate, getMe);
router.put("/me", authenticate, updateMe);
router.patch("/me", authenticate, updateMe);
router.get("/:id/ratings", authenticate, validate({ params: userIdParamSchema }), getRatings);
router.get("/:id/rating-summary", authenticate, validate({ params: userIdParamSchema }), getRatingSummary);
router.get("/:id", authenticate, validate({ params: userIdParamSchema }), getById);
router.post("/skills", authenticate, createSkill);
router.delete("/skills/:id", authenticate, deleteSkill);
router.post("/learning-goals", authenticate, createLearningGoal);
router.delete("/learning-goals/:id", authenticate, deleteLearningGoal);

// --- GDPR rights -----------------------------------------------------------

// Portability: everything we hold about the caller, in a machine-readable form.
router.get(
  "/me/export",
  authenticate,
  async (req, res, next) => {
    try {
      const data = await exportUserData(getAuthenticatedUserId(req));
      res.setHeader("Content-Disposition", 'attachment; filename="skillbridge-export.json"');
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Erasure. Anonymises rather than hard-deleting, so one person's erasure does
 * not rewrite their counterpart's history — see privacyService for the detail.
 *
 * The password is forwarded and checked. The service always took one and this
 * route never sent it, so an irreversible deletion needed nothing but a token.
 */
router.delete(
  "/me",
  authenticate,
  async (req, res, next) => {
    try {
      await deleteAccount(
        getAuthenticatedUserId(req),
        (req.body as { password?: string } | undefined)?.password
      );
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

export default router;
