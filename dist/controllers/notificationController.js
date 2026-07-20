"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.markNotificationAsReadController = exports.getNotificationsController = exports.createNotificationController = void 0;
const httpError_1 = require("../utils/httpError");
const notificationsService_1 = require("../services/notificationsService");
const getAuthenticatedUserId = (req) => {
    if (!req.user)
        throw new httpError_1.HttpError(401, "Authentication required");
    return req.user.id;
};
const createNotificationController = async (req, res, next) => {
    try {
        const { type, message } = req.body;
        const userID = getAuthenticatedUserId(req);
        const notification = await (0, notificationsService_1.createNotificationService)(userID, type, message);
        res.status(201).json(notification);
    }
    catch (error) {
        next(error);
    }
};
exports.createNotificationController = createNotificationController;
const getNotificationsController = async (req, res, next) => {
    try {
        const userID = getAuthenticatedUserId(req);
        const notifications = await (0, notificationsService_1.getNotificationsService)(userID);
        res.status(200).json(notifications);
    }
    catch (error) {
        next(error);
    }
};
exports.getNotificationsController = getNotificationsController;
const markNotificationAsReadController = async (req, res, next) => {
    try {
        const id = req.params.id;
        const userID = getAuthenticatedUserId(req);
        const notification = await (0, notificationsService_1.markNotificationAsReadService)(id, userID);
        res.status(200).json(notification);
    }
    catch (error) {
        next(error);
    }
};
exports.markNotificationAsReadController = markNotificationAsReadController;
//# sourceMappingURL=notificationController.js.map