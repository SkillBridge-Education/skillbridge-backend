"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.markNotificationAsReadService = exports.getNotificationsService = exports.createNotificationService = void 0;
const prisma_1 = require("../utils/prisma");
const sockets_1 = require("../sockets");
const createNotificationService = async (userID, type, message) => {
    const notification = await prisma_1.prisma.notification.create({
        data: {
            userId: userID,
            message: message,
            type: type,
        }
    });
    // Every notification path (messages, sessions, matches, ...) funnels through
    // here, so this is the single place that needs to emit the realtime event.
    (0, sockets_1.emitToUser)(userID, "notification:new", notification);
    return notification;
};
exports.createNotificationService = createNotificationService;
const getNotificationsService = async (userID) => {
    const notifications = await prisma_1.prisma.notification.findMany({
        where: {
            userId: userID,
        },
        orderBy: {
            createdAt: "desc",
        },
    });
    return notifications;
};
exports.getNotificationsService = getNotificationsService;
const markNotificationAsReadService = async (notificationID, userID) => {
    const notification = await prisma_1.prisma.notification.update({
        where: {
            id: notificationID,
            userId: userID,
        },
        data: {
            read: true,
        }
    });
    return notification;
};
exports.markNotificationAsReadService = markNotificationAsReadService;
//# sourceMappingURL=notificationsService.js.map