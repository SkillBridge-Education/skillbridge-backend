import { prisma } from "../utils/prisma";
import { NotificationType } from "@prisma/client";
import { emitToUser } from "../sockets";
import { HttpError } from "../utils/httpError";

export const createNotificationService = async (
    userID : string,
    type : NotificationType,
    message : string,
) => {
    const notification = await prisma.notification.create({
        data: {
            userId: userID,
            message: message,
            type: type,
        }
    });

    // Every notification path (messages, sessions, matches, ...) funnels through
    // here, so this is the single place that needs to emit the realtime event.
    emitToUser(userID, "notification:new", notification);

    return notification;
};

export const getNotificationsService = async (userID : string) => {
    const notifications = await prisma.notification.findMany({
        where: {
            userId: userID,
        },
        orderBy: {
            createdAt: "desc",
        },
    });
    return notifications;
};

export const markNotificationAsReadService = async (notificationID : string, userID : string) => {
    // updateMany returns a count instead of throwing, so a notification that
    // belongs to someone else becomes a clean 404 rather than a raw Prisma
    // error surfacing as a 500.
    const { count } = await prisma.notification.updateMany({
        where: {
            id: notificationID,
            userId: userID,
        },
        data: {
            read: true,
        }
    });

    if (count === 0) {
        throw new HttpError(404, "Notification not found");
    }

    return prisma.notification.findUniqueOrThrow({ where: { id: notificationID } });
};