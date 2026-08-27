import { NextFunction, Request, Response } from "express";
import {
  addLearningGoal,
  addUserSkill,
  getCurrentUserProfile,
  getPublicUserProfile,
  removeLearningGoal,
  removeUserSkill,
  searchUsers,
  updateUserProfile
} from "../services/userService";
import { getUserRatings, getUserRatingSummary } from "../services/ratingService";
import type { SearchQuery } from "../schemas/userSchemas";
import { HttpError } from "../utils/httpError";
import { getAuthenticatedUserId } from "../utils/requestHelpers";
import {
  parseLearningGoalInput,
  parseSkillInput,
  parseUpdateProfileInput
} from "../utils/profileValidation";


const getRouteId = (req: Request): string => {
  const { id } = req.params;

  if (typeof id !== "string" || id.trim().length === 0) {
    throw new HttpError(400, "id route parameter is required");
  }

  return id;
};

export const getMe = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = getAuthenticatedUserId(req);
    const user = await getCurrentUserProfile(userId);

    res.status(200).json({ user });
  } catch (error) {
    next(error);
  }
};

export const updateMe = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = getAuthenticatedUserId(req);
    const input = parseUpdateProfileInput(req.body);
    const user = await updateUserProfile(userId, input);

    res.status(200).json({ user });
  } catch (error) {
    next(error);
  }
};

export const getById = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const user = await getPublicUserProfile(getRouteId(req), getAuthenticatedUserId(req));

    res.status(200).json({ user });
  } catch (error) {
    next(error);
  }
};

export const getRatings = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const ratings = await getUserRatings(getRouteId(req));

    res.status(200).json(ratings);
  } catch (error) {
    next(error);
  }
};

export const getRatingSummary = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const summary = await getUserRatingSummary(getRouteId(req));

    res.status(200).json(summary);
  } catch (error) {
    next(error);
  }
};

export const createSkill = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = getAuthenticatedUserId(req);
    const input = parseSkillInput(req.body);
    const userSkill = await addUserSkill(userId, input);

    res.status(201).json({ skill: userSkill });
  } catch (error) {
    next(error);
  }
};

export const deleteSkill = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = getAuthenticatedUserId(req);

    // The id here is the UserSkill row id, so users can only delete their own join record.
    await removeUserSkill(userId, getRouteId(req));

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

export const createLearningGoal = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = getAuthenticatedUserId(req);
    const input = parseLearningGoalInput(req.body);
    const learningGoal = await addLearningGoal(userId, input);

    res.status(201).json({ learningGoal });
  } catch (error) {
    next(error);
  }
};

export const deleteLearningGoal = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = getAuthenticatedUserId(req);

    await removeLearningGoal(userId, getRouteId(req));

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

export const search = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // The searchQuerySchema middleware has already coerced and bounded these.
    const { q, skill, limit, cursor } = req.query as unknown as SearchQuery;

    const page = await searchUsers({
      query: q,
      skill,
      limit,
      cursor,
      viewerId: getAuthenticatedUserId(req),
    });

    // `users` is kept at the top level so existing clients keep working; the
    // cursor fields are additive.
    res.status(200).json({
      users: page.items,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    });
  } catch (error) {
    next(error);
  }
};
