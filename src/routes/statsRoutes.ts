import { NextFunction, Request, Response, Router } from "express";
import { authenticate } from "../middleware/authMiddleware";
import { getCommunityStats, getFeaturedMembers } from "../services/communityStatsService";

const router = Router();

/**
 * Community figures for the Discover screen. Authenticated because it is only
 * ever shown inside the app, and it saves exposing member counts publicly.
 */
router.get(
  "/community",
  authenticate,
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const [stats, featuredMembers] = await Promise.all([
        getCommunityStats(),
        getFeaturedMembers(),
      ]);
      res.status(200).json({ stats, featuredMembers });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
