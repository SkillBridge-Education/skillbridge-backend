"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const authMiddleware_1 = require("../middleware/authMiddleware");
const sessionController_1 = require("../controllers/sessionController");
const router = (0, express_1.Router)();
router.get("/mine", authMiddleware_1.authenticate, sessionController_1.getSessionsController);
router.post("/", authMiddleware_1.authenticate, sessionController_1.createSessionController);
router.post("/group", authMiddleware_1.authenticate, sessionController_1.createGroupSessionController); // ← avant /:id
router.get("/:id", authMiddleware_1.authenticate, sessionController_1.getSessionController);
router.patch("/:id", authMiddleware_1.authenticate, sessionController_1.updateSessionController);
router.post("/:id/end", authMiddleware_1.authenticate, sessionController_1.endSessionController);
router.post("/:id/join", authMiddleware_1.authenticate, sessionController_1.joinSessionController);
router.post("/:id/accept", authMiddleware_1.authenticate, sessionController_1.acceptSessionController);
router.post("/:id/refuse", authMiddleware_1.authenticate, sessionController_1.refuseSessionController);
router.post("/:id/rating", authMiddleware_1.authenticate, sessionController_1.createSessionRatingController);
router.post("/:id/participants", authMiddleware_1.authenticate, sessionController_1.addParticipantSessionController);
router.delete("/:id/participants/:userId", authMiddleware_1.authenticate, sessionController_1.removeParticipantSessionController);
router.get("/:id/participants", authMiddleware_1.authenticate, sessionController_1.getParticipantsSessionController);
exports.default = router;
//# sourceMappingURL=sessionRoutes.js.map