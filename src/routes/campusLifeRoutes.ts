import { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/authMiddleware";
import { validate } from "../middleware/validate";
import { contentRateLimiter } from "../middleware/rateLimit";
import { getAuthenticatedUserId } from "../utils/requestHelpers";
import {
  cancelCourse,
  cancelEvent,
  createCourse,
  createEvent,
  joinCourse,
  leaveCourse,
  listCourses,
  listEvents,
} from "../services/campusLifeService";

/**
 * Cours et evenements d'un etablissement.
 *
 * Aucune route ne prend d'identifiant d'etablissement : il est toujours lu
 * depuis l'adhesion du demandeur. Accepter celui du client permettrait de lire
 * — ou de remplir — l'agenda d'une autre ecole.
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

const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.string().uuid("Identifiant invalide") });

const dateField = z.coerce.date();

const courseBody = z.object({
  title: z.string().trim().min(2, "Le titre est requis").max(150),
  description: z.string().trim().max(2000).optional(),
  studyLevel: z.string().trim().max(60).optional(),
  teacherId: z.string().uuid().optional(),
  startsAt: dateField,
  endsAt: dateField.optional(),
  location: z.string().trim().max(200).optional(),
  isOnline: z.boolean().optional(),
  // Nul = pas de limite ; zero serait ambigu avec "complet".
  capacity: z.number().int().positive().max(1000).optional(),
  campusId: z.string().uuid().optional(),
});

const eventBody = z.object({
  title: z.string().trim().min(2, "Le titre est requis").max(150),
  description: z.string().trim().max(4000).optional(),
  startsAt: dateField,
  endsAt: dateField.optional(),
  location: z.string().trim().max(200).optional(),
  bannerUrl: z.string().trim().max(2048).optional(),
  isPinned: z.boolean().optional(),
  campusId: z.string().uuid().optional(),
});

const listQuery = z.object({
  past: z.coerce.boolean().optional(),
  mine: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

// --- Cours ------------------------------------------------------------------

router.get(
  "/courses",
  validate({ query: listQuery }),
  handle(async (req, res) => {
    const courses = await listCourses(getAuthenticatedUserId(req), req.query as never);
    res.status(200).json({ courses });
  })
);

router.post(
  "/courses",
  contentRateLimiter,
  validate({ body: courseBody }),
  handle(async (req, res) => {
    const course = await createCourse(getAuthenticatedUserId(req), req.body);
    res.status(201).json({ course });
  })
);

router.post(
  "/courses/:id/join",
  validate({ params: idParam }),
  handle(async (req, res) => {
    const result = await joinCourse(getAuthenticatedUserId(req), req.params.id as string);
    res.status(200).json(result);
  })
);

router.delete(
  "/courses/:id/join",
  validate({ params: idParam }),
  handle(async (req, res) => {
    const result = await leaveCourse(getAuthenticatedUserId(req), req.params.id as string);
    res.status(200).json(result);
  })
);

/** Annulation, pas suppression : ceux qui s'etaient inscrits doivent le voir. */
router.post(
  "/courses/:id/cancel",
  validate({ params: idParam }),
  handle(async (req, res) => {
    const course = await cancelCourse(getAuthenticatedUserId(req), req.params.id as string);
    res.status(200).json({ course });
  })
);

// --- Evenements -------------------------------------------------------------

router.get(
  "/events",
  validate({ query: listQuery }),
  handle(async (req, res) => {
    const events = await listEvents(getAuthenticatedUserId(req), req.query as never);
    res.status(200).json({ events });
  })
);

router.post(
  "/events",
  contentRateLimiter,
  validate({ body: eventBody }),
  handle(async (req, res) => {
    const event = await createEvent(getAuthenticatedUserId(req), req.body);
    res.status(201).json({ event });
  })
);

router.post(
  "/events/:id/cancel",
  validate({ params: idParam }),
  handle(async (req, res) => {
    const event = await cancelEvent(getAuthenticatedUserId(req), req.params.id as string);
    res.status(200).json({ event });
  })
);

export default router;
