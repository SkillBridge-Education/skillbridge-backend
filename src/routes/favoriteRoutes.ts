import { NextFunction, Request, Response, Router } from "express";
import { Prisma, UserStatus } from "@prisma/client";
import { z } from "zod";
import { authenticate } from "../middleware/authMiddleware";
import { validate } from "../middleware/validate";
import { getAuthenticatedUserId } from "../utils/requestHelpers";
import { prisma } from "../utils/prisma";
import { HttpError } from "../utils/httpError";

/**
 * Shortlisting someone to come back to later.
 *
 * Deliberately silent and one-sided: the person favourited is never notified
 * and cannot see it. That is what makes it usable as a private shortlist rather
 * than a soft connection request — the point is precisely to note someone
 * *without* engaging them yet.
 */

const handle =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await fn(req, res);
    } catch (error) {
      next(error);
    }
  };

const idParam = z.object({ id: z.string().uuid("A valid user id is required") });

const router = Router();

router.use(authenticate);

router.get(
  "/",
  handle(async (req, res) => {
    const favorites = await prisma.favorite.findMany({
      where: { userId: getAuthenticatedUserId(req) },
      select: {
        id: true,
        createdAt: true,
        favorited: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
            bio: true,
            averageRating: true,
            totalRatings: true,
            status: true,
            teachingSkills: {
              select: { skill: { select: { id: true, name: true, category: true } } },
              take: 5,
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    // A favourited account that has since been deleted or suspended stays in
    // the table but is not worth showing.
    res.status(200).json({
      favorites: favorites.filter((row) => row.favorited.status === UserStatus.ACTIVE),
    });
  })
);

/** Which of a set of profiles are already favourited, for list screens. */
router.post(
  "/lookup",
  validate({ body: z.object({ userIds: z.array(z.string().uuid()).max(100) }) }),
  handle(async (req, res) => {
    const rows = await prisma.favorite.findMany({
      where: {
        userId: getAuthenticatedUserId(req),
        favoritedId: { in: req.body.userIds as string[] },
      },
      select: { favoritedId: true },
    });

    res.status(200).json({ favoritedIds: rows.map((row) => row.favoritedId) });
  })
);

router.post(
  "/:id",
  validate({ params: idParam }),
  handle(async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    const favoritedId = req.params.id as string;

    if (userId === favoritedId) {
      throw new HttpError(400, "You cannot add yourself to your favourites");
    }

    const target = await prisma.user.findUnique({
      where: { id: favoritedId },
      select: { status: true },
    });
    if (!target || target.status !== UserStatus.ACTIVE) {
      throw new HttpError(404, "User not found");
    }

    try {
      const favorite = await prisma.favorite.create({
        data: { userId, favoritedId },
        select: { id: true, favoritedId: true, createdAt: true },
      });
      res.status(201).json({ favorite });
    } catch (error) {
      // Favouriting twice is not an error from the user's point of view.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await prisma.favorite.findFirstOrThrow({
          where: { userId, favoritedId },
          select: { id: true, favoritedId: true, createdAt: true },
        });
        res.status(200).json({ favorite: existing });
        return;
      }
      throw error;
    }
  })
);

router.delete(
  "/:id",
  validate({ params: idParam }),
  handle(async (req, res) => {
    const { count } = await prisma.favorite.deleteMany({
      where: { userId: getAuthenticatedUserId(req), favoritedId: req.params.id as string },
    });

    if (count === 0) throw new HttpError(404, "This user is not in your favourites");
    res.status(204).send();
  })
);

export default router;
