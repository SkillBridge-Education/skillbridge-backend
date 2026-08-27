import { Request, Response, NextFunction } from "express";
import { HttpError } from "../utils/httpError";
import { prisma } from "../utils/prisma";
import { getAuthenticatedUserId } from "../utils/requestHelpers";
import {
  addParticipantSessionService,
  createGroupSessionService,
  createSessionService,
  endSessionService,
  getParticipantsSessionService,
  joinSessionService,
  removeParticipantSessionService,
  acceptSessionService,
  cancelSessionService,
  refuseSessionService,
  updateSessionService,
} from "../services/sessionService";
import { createSessionRating } from "../services/ratingService";

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
} as const;

// GET /sessions/mine
export const getSessionsController = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = getAuthenticatedUserId(req);
    const sessions = await prisma.teachingSession.findMany({
      where: {
        OR: [{ teacherId: userId }, { learnerId: userId }],
      },
      select: SESSION_SELECT,
      orderBy: { startsAt: "desc" },
    });
    res.status(200).json({ sessions });
  } catch (error) {
    next(error);
  }
};

// GET /sessions/:id
export const getSessionController = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = getAuthenticatedUserId(req);
    const sessionId = req.params.id as string;

    const session = await prisma.teachingSession.findFirst({
      where: {
        id: sessionId,
        OR: [{ teacherId: userId }, { learnerId: userId }],
      },
      select: SESSION_SELECT,
    });

    if (!session) throw new HttpError(404, "Session not found");
    res.status(200).json({ session });
  } catch (error) {
    next(error);
  }
};

// POST /sessions
export const createSessionController = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const teacherId = getAuthenticatedUserId(req);
    const { learnerId, title, estimatedDuration, scheduledAt } = req.body;

    if (!learnerId || typeof learnerId !== "string")
      throw new HttpError(400, "learnerId is required");
    if (!title || typeof title !== "string")
      throw new HttpError(400, "title is required");
    if (!estimatedDuration || typeof estimatedDuration !== "number")
      throw new HttpError(400, "estimatedDuration (number) is required");
    if (!scheduledAt)
      throw new HttpError(400, "scheduledAt is required");

    const session = await createSessionService(
      teacherId,
      learnerId,
      title,
      estimatedDuration,
      new Date(scheduledAt as string)
    );
    res.status(201).json({ session });
  } catch (error) {
    next(error);
  }
};

// POST /sessions/:id/end
export const endSessionController = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const sessionId = req.params.id as string;
    const userId = getAuthenticatedUserId(req);
    const { durationSeconds } = req.body;

    if (
      durationSeconds === undefined ||
      !Number.isSafeInteger(durationSeconds) ||
      durationSeconds < 0
    ) {
      throw new HttpError(400, "durationSeconds (safe non-negative integer) is required");
    }

    const result = await endSessionService(sessionId, userId, durationSeconds);
    res.status(200).json({ message: "Session ended successfully", ...result });
  } catch (error) {
    next(error);
  }
};

// POST /sessions/:id/join
export const joinSessionController = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const sessionId = req.params.id as string;
    const userId = getAuthenticatedUserId(req);
    const jitsiRoomId = await joinSessionService(sessionId, userId);
    res.status(200).json({
      jitsiRoomId,
      jitsiUrl: `https://meet.jit.si/${jitsiRoomId}#config.prejoinPageEnabled=false`,
    });
  } catch (error) {
    next(error);
  }
};

// POST /sessions/:id/rating
export const createSessionRatingController = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const sessionId = req.params.id as string;
    const reviewerId = getAuthenticatedUserId(req);
    const { reviewedUserId, rating, comment } = req.body;

    if (typeof reviewedUserId !== "string" || reviewedUserId.trim().length === 0) {
      throw new HttpError(400, "reviewedUserId is required");
    }

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new HttpError(400, "rating must be an integer between 1 and 5");
    }

    if (comment !== undefined && comment !== null && typeof comment !== "string") {
      throw new HttpError(400, "comment must be a string");
    }

    const sessionRating = await createSessionRating({
      sessionId,
      reviewerId,
      reviewedUserId: reviewedUserId.trim(),
      rating,
      comment
    });

    res.status(201).json({ rating: sessionRating });
  } catch (error) {
    next(error);
  }
};

// POST /sessions/:id/accept
export const acceptSessionController = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const sessionId = req.params.id as string;
    const learnerId = getAuthenticatedUserId(req);
    const session = await acceptSessionService(sessionId, learnerId);
    res.status(200).json({ session });
  } catch (error) {
    next(error);
  }
};

// POST /sessions/:id/refuse
export const refuseSessionController = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const sessionId = req.params.id as string;
    const learnerId = getAuthenticatedUserId(req);
    const session = await refuseSessionService(sessionId, learnerId);
    res.status(200).json({ session });
  } catch (error) {
    next(error);
  }
};

// PATCH /sessions/:id
export const updateSessionController = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const sessionId = req.params.id as string;
    const teacherId = getAuthenticatedUserId(req);
    const { estimatedDuration, scheduledAt, title } = req.body;

    if (
      estimatedDuration !== undefined &&
      (!Number.isInteger(estimatedDuration) || estimatedDuration <= 0)
    ) {
      throw new HttpError(400, "estimatedDuration must be a positive integer");
    }

    const session = await updateSessionService(sessionId, teacherId, {
      estimatedDuration,
      scheduledAt,
      title,
    });
    res.status(200).json({ session });
  } catch (error) {
    next(error);
  }
};

export const createGroupSessionController = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const teacherId = getAuthenticatedUserId(req);
    const { learnerIds, title, estimatedDuration, scheduledAt } = req.body;

    if (!learnerIds || !Array.isArray(learnerIds) || learnerIds.length === 0) {
      throw new HttpError(400, "learnerIds is required and must be a non-empty array");
    }
    if (!title || typeof title !== "string") {
      throw new HttpError(400, "title is required");
    }
    if (!estimatedDuration || typeof estimatedDuration !== "number") {
      throw new HttpError(400, "estimatedDuration (number) is required");
    }
    if (!scheduledAt) {
      throw new HttpError(400, "scheduledAt is required");
    }
    res.status(201).json({
      session: await createGroupSessionService(
        teacherId,
        learnerIds,
        title,
        estimatedDuration,
        new Date(scheduledAt as string)
      )
    });
  } catch (error) {
    next(error);
  }
};
export const addParticipantSessionController = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const sessionId = req.params.id as string;
    const requesterId = getAuthenticatedUserId(req);
    const userId = req.body.userId as string;

    if (!userId || typeof userId !== "string") {
      throw new HttpError(400, "userId is required and must be a string");
    }

    // Logic to add participant goes here
    const updatedSession = await addParticipantSessionService(sessionId, requesterId, userId);
    res.status(200).json({ session: updatedSession });
  } catch (error) {
    next(error);
  }
};

export const removeParticipantSessionController = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const sessionId = req.params.id as string;
    const requesterId = getAuthenticatedUserId(req);
    const userId = req.params.userId as string;

    if (!userId || typeof userId !== "string") {
      throw new HttpError(400, "userId is required and must be a string");
    }
    // Logic to remove participant goes here
    const updatedSession = await removeParticipantSessionService(sessionId, requesterId, userId);
    res.status(200).json({ session: updatedSession });
  } catch (error) {
    next(error);
  }
};

export const getParticipantsSessionController = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const sessionId = req.params.id as string;
    const requesterId = getAuthenticatedUserId(req);

    const participants = await getParticipantsSessionService(sessionId, requesterId);
    res.status(200).json({ participants });
  } catch (error) {
    next(error);
  }
};

// POST /sessions/:id/cancel
export const cancelSessionController = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const session = await cancelSessionService(
      req.params.id as string,
      getAuthenticatedUserId(req)
    );
    res.status(200).json(session);
  } catch (error) {
    next(error);
  }
};
