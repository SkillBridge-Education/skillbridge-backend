import { Router } from "express";
import { authenticate } from "../middleware/authMiddleware";
import { validate } from "../middleware/validate";
import {
  createGroupSessionSchema,
  createSessionSchema,
  endSessionSchema,
  sessionIdParamSchema,
} from "../schemas/sessionSchemas";
import {
  createGroupSessionController,
  createSessionRatingController,
  createSessionController,
  endSessionController,
  joinSessionController,
  addParticipantSessionController,
  removeParticipantSessionController,
  getParticipantsSessionController,
  getSessionsController,
  getSessionController,
  acceptSessionController,
  refuseSessionController,
  updateSessionController,
} from "../controllers/sessionController";

const router = Router();

const withId = validate({ params: sessionIdParamSchema });

router.get("/mine",        authenticate, getSessionsController);
router.post("/",           authenticate, validate({ body: createSessionSchema }), createSessionController);
router.post("/group",      authenticate, validate({ body: createGroupSessionSchema }), createGroupSessionController); // ← avant /:id
router.get("/:id",         authenticate, withId, getSessionController);
router.patch("/:id",       authenticate, withId, updateSessionController);
router.post("/:id/end",    authenticate, withId, validate({ body: endSessionSchema }), endSessionController);
router.post("/:id/join",   authenticate, withId, joinSessionController);
router.post("/:id/accept", authenticate, withId, acceptSessionController);
router.post("/:id/refuse", authenticate, withId, refuseSessionController);
router.post("/:id/rating", authenticate, withId, createSessionRatingController);
router.post("/:id/participants", authenticate, withId, addParticipantSessionController);
router.delete("/:id/participants/:userId", authenticate, withId, removeParticipantSessionController);
router.get("/:id/participants", authenticate, withId, getParticipantsSessionController);

export default router;
