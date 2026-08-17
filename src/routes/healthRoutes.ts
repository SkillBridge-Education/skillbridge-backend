import { Router } from "express";
import { getHealthCheck } from "../controllers/healthController";

const router = Router();

router.get("/", getHealthCheck);

// Monitoring tools probe /health by convention; keep both so existing callers
// of "/" are not broken.
router.get("/health", getHealthCheck);

export default router;
