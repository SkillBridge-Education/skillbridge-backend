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

// Search returns public profile data, so it does not require a JWT — which also
// makes it the cheapest endpoint to abuse for scraping the member directory.
router.get(
  "/search",
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
router.get("/:id", validate({ params: userIdParamSchema }), getById);
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

// Erasure. Anonymises rather than hard-deleting, so one person's erasure does
// not rewrite their counterpart's history — see privacyService for the detail.
router.delete(
  "/me",
  authenticate,
  async (req, res, next) => {
    try {
      await deleteAccount(getAuthenticatedUserId(req));
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

export default router;
