import { Request, Response, NextFunction } from "express";
import { HttpError } from "../utils/httpError";
import {
  createNotificationService,
  getNotificationsService,
  markNotificationAsReadService,
} from "../services/notificationsService";

const getAuthenticatedUserId = (req: any): string => {
  if (!req.user) throw new HttpError(401, "Authentication required");
  return req.user.id;
};

export const createNotificationController = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
  try {
    const { type, message } = req.body;
    const userID = getAuthenticatedUserId(req);

    const notification = await createNotificationService(userID, type, message);
    res.status(201).json(notification);
  } catch (error) {
    next(error);
  }
};

export const getNotificationsController = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
      const userID = getAuthenticatedUserId(req);
      const notifications = await getNotificationsService(userID);
      res.status(200).json(notifications);
    } catch (error) {
      next(error);
    }
};

export const markNotificationAsReadController = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const id = req.params.id as string;
        const userID = getAuthenticatedUserId(req);
        const notification = await markNotificationAsReadService(id, userID);
        res.status(200).json(notification);
    } catch (error) {
        next(error);
    }
};
