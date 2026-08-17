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

export default router;
