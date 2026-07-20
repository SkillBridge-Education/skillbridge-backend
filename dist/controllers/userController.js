"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.search = exports.deleteLearningGoal = exports.createLearningGoal = exports.deleteSkill = exports.createSkill = exports.getRatingSummary = exports.getRatings = exports.getById = exports.updateMe = exports.getMe = void 0;
const userService_1 = require("../services/userService");
const ratingService_1 = require("../services/ratingService");
const httpError_1 = require("../utils/httpError");
const requestHelpers_1 = require("../utils/requestHelpers");
const profileValidation_1 = require("../utils/profileValidation");
const getRouteId = (req) => {
    const { id } = req.params;
    if (typeof id !== "string" || id.trim().length === 0) {
        throw new httpError_1.HttpError(400, "id route parameter is required");
    }
    return id;
};
const getMe = async (req, res, next) => {
    try {
        const userId = (0, requestHelpers_1.getAuthenticatedUserId)(req);
        const user = await (0, userService_1.getCurrentUserProfile)(userId);
        res.status(200).json({ user });
    }
    catch (error) {
        next(error);
    }
};
exports.getMe = getMe;
const updateMe = async (req, res, next) => {
    try {
        const userId = (0, requestHelpers_1.getAuthenticatedUserId)(req);
        const input = (0, profileValidation_1.parseUpdateProfileInput)(req.body);
        const user = await (0, userService_1.updateUserProfile)(userId, input);
        res.status(200).json({ user });
    }
    catch (error) {
        next(error);
    }
};
exports.updateMe = updateMe;
const getById = async (req, res, next) => {
    try {
        const user = await (0, userService_1.getPublicUserProfile)(getRouteId(req));
        res.status(200).json({ user });
    }
    catch (error) {
        next(error);
    }
};
exports.getById = getById;
const getRatings = async (req, res, next) => {
    try {
        const ratings = await (0, ratingService_1.getUserRatings)(getRouteId(req));
        res.status(200).json(ratings);
    }
    catch (error) {
        next(error);
    }
};
exports.getRatings = getRatings;
const getRatingSummary = async (req, res, next) => {
    try {
        const summary = await (0, ratingService_1.getUserRatingSummary)(getRouteId(req));
        res.status(200).json(summary);
    }
    catch (error) {
        next(error);
    }
};
exports.getRatingSummary = getRatingSummary;
const createSkill = async (req, res, next) => {
    try {
        const userId = (0, requestHelpers_1.getAuthenticatedUserId)(req);
        const input = (0, profileValidation_1.parseSkillInput)(req.body);
        const userSkill = await (0, userService_1.addUserSkill)(userId, input);
        res.status(201).json({ skill: userSkill });
    }
    catch (error) {
        next(error);
    }
};
exports.createSkill = createSkill;
const deleteSkill = async (req, res, next) => {
    try {
        const userId = (0, requestHelpers_1.getAuthenticatedUserId)(req);
        // The id here is the UserSkill row id, so users can only delete their own join record.
        await (0, userService_1.removeUserSkill)(userId, getRouteId(req));
        res.status(204).send();
    }
    catch (error) {
        next(error);
    }
};
exports.deleteSkill = deleteSkill;
const createLearningGoal = async (req, res, next) => {
    try {
        const userId = (0, requestHelpers_1.getAuthenticatedUserId)(req);
        const input = (0, profileValidation_1.parseLearningGoalInput)(req.body);
        const learningGoal = await (0, userService_1.addLearningGoal)(userId, input);
        res.status(201).json({ learningGoal });
    }
    catch (error) {
        next(error);
    }
};
exports.createLearningGoal = createLearningGoal;
const deleteLearningGoal = async (req, res, next) => {
    try {
        const userId = (0, requestHelpers_1.getAuthenticatedUserId)(req);
        await (0, userService_1.removeLearningGoal)(userId, getRouteId(req));
        res.status(204).send();
    }
    catch (error) {
        next(error);
    }
};
exports.deleteLearningGoal = deleteLearningGoal;
const search = async (req, res, next) => {
    try {
        const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
        if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
            throw new httpError_1.HttpError(400, "limit must be a positive integer");
        }
        const users = await (0, userService_1.searchUsers)({
            query: typeof req.query.q === "string" ? req.query.q : undefined,
            skill: typeof req.query.skill === "string" ? req.query.skill : undefined,
            limit
        });
        res.status(200).json({ users });
    }
    catch (error) {
        next(error);
    }
};
exports.search = search;
//# sourceMappingURL=userController.js.map