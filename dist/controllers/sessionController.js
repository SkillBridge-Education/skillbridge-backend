"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getParticipantsSessionController = exports.removeParticipantSessionController = exports.addParticipantSessionController = exports.createGroupSessionController = exports.updateSessionController = exports.refuseSessionController = exports.acceptSessionController = exports.createSessionRatingController = exports.joinSessionController = exports.endSessionController = exports.createSessionController = exports.getSessionController = exports.getSessionsController = void 0;
const httpError_1 = require("../utils/httpError");
const prisma_1 = require("../utils/prisma");
const requestHelpers_1 = require("../utils/requestHelpers");
const sessionService_1 = require("../services/sessionService");
const ratingService_1 = require("../services/ratingService");
const SESSION_SELECT = {
    id: true,
    status: true,
    startsAt: true,
    title: true,
    jitsiRoomId: true,
    creditsReserved: true,
    creditsConsumed: true,
    actualStartedAt: true,
    actualEndedAt: true,
    teacher: { select: { id: true, firstName: true, lastName: true } },
    learner: { select: { id: true, firstName: true, lastName: true } },
};
// GET /sessions/mine
const getSessionsController = async (req, res, next) => {
    try {
        const userId = (0, requestHelpers_1.getAuthenticatedUserId)(req);
        const sessions = await prisma_1.prisma.teachingSession.findMany({
            where: {
                OR: [{ teacherId: userId }, { learnerId: userId }],
            },
            select: SESSION_SELECT,
            orderBy: { startsAt: "desc" },
        });
        res.status(200).json({ sessions });
    }
    catch (error) {
        next(error);
    }
};
exports.getSessionsController = getSessionsController;
// GET /sessions/:id
const getSessionController = async (req, res, next) => {
    try {
        const userId = (0, requestHelpers_1.getAuthenticatedUserId)(req);
        const sessionId = req.params.id;
        const session = await prisma_1.prisma.teachingSession.findFirst({
            where: {
                id: sessionId,
                OR: [{ teacherId: userId }, { learnerId: userId }],
            },
            select: SESSION_SELECT,
        });
        if (!session)
            throw new httpError_1.HttpError(404, "Session not found");
        res.status(200).json({ session });
    }
    catch (error) {
        next(error);
    }
};
exports.getSessionController = getSessionController;
// POST /sessions
const createSessionController = async (req, res, next) => {
    try {
        const teacherId = (0, requestHelpers_1.getAuthenticatedUserId)(req);
        const { learnerId, title, estimatedDuration, scheduledAt } = req.body;
        if (!learnerId || typeof learnerId !== "string")
            throw new httpError_1.HttpError(400, "learnerId is required");
        if (!title || typeof title !== "string")
            throw new httpError_1.HttpError(400, "title is required");
        if (!estimatedDuration || typeof estimatedDuration !== "number")
            throw new httpError_1.HttpError(400, "estimatedDuration (number) is required");
        if (!scheduledAt)
            throw new httpError_1.HttpError(400, "scheduledAt is required");
        const session = await (0, sessionService_1.createSessionService)(teacherId, learnerId, title, estimatedDuration, new Date(scheduledAt));
        res.status(201).json({ session });
    }
    catch (error) {
        next(error);
    }
};
exports.createSessionController = createSessionController;
// POST /sessions/:id/end
const endSessionController = async (req, res, next) => {
    try {
        const sessionId = req.params.id;
        const userId = (0, requestHelpers_1.getAuthenticatedUserId)(req);
        const { durationSeconds } = req.body;
        if (durationSeconds === undefined ||
            !Number.isSafeInteger(durationSeconds) ||
            durationSeconds < 0) {
            throw new httpError_1.HttpError(400, "durationSeconds (safe non-negative integer) is required");
        }
        const result = await (0, sessionService_1.endSessionService)(sessionId, userId, durationSeconds);
        res.status(200).json({ message: "Session ended successfully", ...result });
    }
    catch (error) {
        next(error);
    }
};
exports.endSessionController = endSessionController;
// POST /sessions/:id/join
const joinSessionController = async (req, res, next) => {
    try {
        const sessionId = req.params.id;
        const userId = (0, requestHelpers_1.getAuthenticatedUserId)(req);
        const jitsiRoomId = await (0, sessionService_1.joinSessionService)(sessionId, userId);
        res.status(200).json({
            jitsiRoomId,
            jitsiUrl: `https://meet.jit.si/${jitsiRoomId}#config.prejoinPageEnabled=false`,
        });
    }
    catch (error) {
        next(error);
    }
};
exports.joinSessionController = joinSessionController;
// POST /sessions/:id/rating
const createSessionRatingController = async (req, res, next) => {
    try {
        const sessionId = req.params.id;
        const reviewerId = (0, requestHelpers_1.getAuthenticatedUserId)(req);
        const { reviewedUserId, rating, comment } = req.body;
        if (typeof reviewedUserId !== "string" || reviewedUserId.trim().length === 0) {
            throw new httpError_1.HttpError(400, "reviewedUserId is required");
        }
        if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
            throw new httpError_1.HttpError(400, "rating must be an integer between 1 and 5");
        }
        if (comment !== undefined && comment !== null && typeof comment !== "string") {
            throw new httpError_1.HttpError(400, "comment must be a string");
        }
        const sessionRating = await (0, ratingService_1.createSessionRating)({
            sessionId,
            reviewerId,
            reviewedUserId: reviewedUserId.trim(),
            rating,
            comment
        });
        res.status(201).json({ rating: sessionRating });
    }
    catch (error) {
        next(error);
    }
};
exports.createSessionRatingController = createSessionRatingController;
// POST /sessions/:id/accept
const acceptSessionController = async (req, res, next) => {
    try {
        const sessionId = req.params.id;
        const learnerId = (0, requestHelpers_1.getAuthenticatedUserId)(req);
        const session = await (0, sessionService_1.acceptSessionService)(sessionId, learnerId);
        res.status(200).json({ session });
    }
    catch (error) {
        next(error);
    }
};
exports.acceptSessionController = acceptSessionController;
// POST /sessions/:id/refuse
const refuseSessionController = async (req, res, next) => {
    try {
        const sessionId = req.params.id;
        const learnerId = (0, requestHelpers_1.getAuthenticatedUserId)(req);
        const session = await (0, sessionService_1.refuseSessionService)(sessionId, learnerId);
        res.status(200).json({ session });
    }
    catch (error) {
        next(error);
    }
};
exports.refuseSessionController = refuseSessionController;
// PATCH /sessions/:id
const updateSessionController = async (req, res, next) => {
    try {
        const sessionId = req.params.id;
        const teacherId = (0, requestHelpers_1.getAuthenticatedUserId)(req);
        const { estimatedDuration, scheduledAt, title } = req.body;
        if (estimatedDuration !== undefined &&
            (!Number.isInteger(estimatedDuration) || estimatedDuration <= 0)) {
            throw new httpError_1.HttpError(400, "estimatedDuration must be a positive integer");
        }
        const session = await (0, sessionService_1.updateSessionService)(sessionId, teacherId, {
            estimatedDuration,
            scheduledAt,
            title,
        });
        res.status(200).json({ session });
    }
    catch (error) {
        next(error);
    }
};
exports.updateSessionController = updateSessionController;
const createGroupSessionController = async (req, res, next) => {
    try {
        const teacherId = (0, requestHelpers_1.getAuthenticatedUserId)(req);
        const { learnerIds, title, estimatedDuration, scheduledAt } = req.body;
        if (!learnerIds || !Array.isArray(learnerIds) || learnerIds.length === 0) {
            throw new httpError_1.HttpError(400, "learnerIds is required and must be a non-empty array");
        }
        if (!title || typeof title !== "string") {
            throw new httpError_1.HttpError(400, "title is required");
        }
        if (!estimatedDuration || typeof estimatedDuration !== "number") {
            throw new httpError_1.HttpError(400, "estimatedDuration (number) is required");
        }
        if (!scheduledAt) {
            throw new httpError_1.HttpError(400, "scheduledAt is required");
        }
        res.status(201).json({
            session: await (0, sessionService_1.createGroupSessionService)(teacherId, learnerIds, title, estimatedDuration, new Date(scheduledAt))
        });
    }
    catch (error) {
        next(error);
    }
};
exports.createGroupSessionController = createGroupSessionController;
const addParticipantSessionController = async (req, res, next) => {
    try {
        const sessionId = req.params.id;
        const requesterId = (0, requestHelpers_1.getAuthenticatedUserId)(req);
        const userId = req.body.userId;
        if (!userId || typeof userId !== "string") {
            throw new httpError_1.HttpError(400, "userId is required and must be a string");
        }
        // Logic to add participant goes here
        const updatedSession = await (0, sessionService_1.addParticipantSessionService)(sessionId, requesterId, userId);
        res.status(200).json({ session: updatedSession });
    }
    catch (error) {
        next(error);
    }
};
exports.addParticipantSessionController = addParticipantSessionController;
const removeParticipantSessionController = async (req, res, next) => {
    try {
        const sessionId = req.params.id;
        const requesterId = (0, requestHelpers_1.getAuthenticatedUserId)(req);
        const userId = req.params.userId;
        if (!userId || typeof userId !== "string") {
            throw new httpError_1.HttpError(400, "userId is required and must be a string");
        }
        // Logic to remove participant goes here
        const updatedSession = await (0, sessionService_1.removeParticipantSessionService)(sessionId, requesterId, userId);
        res.status(200).json({ session: updatedSession });
    }
    catch (error) {
        next(error);
    }
};
exports.removeParticipantSessionController = removeParticipantSessionController;
const getParticipantsSessionController = async (req, res, next) => {
    try {
        const sessionId = req.params.id;
        const requesterId = (0, requestHelpers_1.getAuthenticatedUserId)(req);
        const participants = await (0, sessionService_1.getParticipantsSessionService)(sessionId, requesterId);
        res.status(200).json({ participants });
    }
    catch (error) {
        next(error);
    }
};
exports.getParticipantsSessionController = getParticipantsSessionController;
//# sourceMappingURL=sessionController.js.map