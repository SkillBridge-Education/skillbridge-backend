import { NextFunction, Request, Response, Router } from "express";
import { authenticate } from "../middleware/authMiddleware";
import { validate } from "../middleware/validate";
import { contentRateLimiter } from "../middleware/rateLimit";
import { authRateLimiter } from "../middleware/authRateLimit";
import { getAuthenticatedUserId } from "../utils/requestHelpers";
import { z } from "zod";
import { requireOrgAdmin } from "../services/organizationService";
import { lireIdentite, mettreAJourIdentite } from "../services/brandingService";
import { fileUrlSchema } from "../schemas/messageSchemas";
import {
  applyForEstablishment,
  getMyApplication,
  issueAccessCode,
  issueAccessCodesInBulk,
  listAccessCodes,
  resolveAccessCode,
  revokeAccessCode,
} from "../services/establishmentService";
import {
  applyForEstablishmentSchema,
  bulkAccessCodeSchema,
  codeIdParamSchema,
  issueAccessCodeSchema,
  listAccessCodesQuerySchema,
  redeemAccessCodeSchema,
} from "../schemas/establishmentSchemas";

/**
 * "Mon etablissement": applying to register a school, and issuing the
 * identifiers that let its members in.
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

// --- Verifying a code, before an account exists -----------------------------

/**
 * Checks a code and address pair without creating anything.
 *
 * Unauthenticated because it runs *during* sign-up, before there is an account —
 * and rate-limited with the auth limiter for the same reason: it answers a
 * question about whether an address is enrolled at a school, which is exactly
 * the kind of thing worth guessing at scale.
 */
router.post(
  "/access-codes/verify",
  authRateLimiter,
  validate({ body: redeemAccessCodeSchema }),
  handle(async (req, res) => {
    const resolved = await resolveAccessCode(req.body.code as string, req.body.email as string);

    // Deliberately narrow: enough to show "Vous rejoignez HETIC en tant
    // qu'eleve", and nothing that would turn this into a directory.
    res.status(200).json({
      role: resolved.role,
      organization: {
        name: resolved.organization.name,
        shortName: resolved.organization.shortName,
      },
    });
  })
);

router.use(authenticate);

// --- Applying to register a school ------------------------------------------

router.post(
  "/apply",
  contentRateLimiter,
  validate({ body: applyForEstablishmentSchema }),
  handle(async (req, res) => {
    const organization = await applyForEstablishment(getAuthenticatedUserId(req), req.body);
    res.status(201).json({ organization });
  })
);

/** What the representative sees while their application is being reviewed. */
router.get(
  "/my-application",
  handle(async (req, res) => {
    const application = await getMyApplication(getAuthenticatedUserId(req));
    res.status(200).json({ application });
  })
);

// --- L'identite visuelle de l'etablissement ---------------------------------

/**
 * Lire et poser le logo, la banniere et la couleur.
 *
 * Administrateurs uniquement : ce ne sont pas des preferences personnelles,
 * c'est ce que tous les membres verront chaque jour.
 *
 * Les trois champs sont independants. On demande le logo au premier passage,
 * la couleur juste apres -- proposee a partir du logo -- et la banniere plus
 * tard, quand elle sert. Un formulaire exigeant trois televersements d'un coup
 * se referme sans etre rempli.
 */
router.get(
  "/identity",
  handle(async (req, res) => {
    res.status(200).json({ identity: await lireIdentite(getAuthenticatedUserId(req)) });
  })
);

router.patch(
  "/identity",
  contentRateLimiter,
  validate({
    body: z
      .object({
        logoUrl: fileUrlSchema.nullable().optional(),
        bannerUrl: fileUrlSchema.nullable().optional(),
        brandColor: z
          .string()
          .trim()
          .regex(/^#[0-9a-fA-F]{6}$/, "La couleur doit etre au format #RRGGBB")
          .nullable()
          .optional(),
      })
      .refine((b) => Object.keys(b).length > 0, "Aucun champ a modifier"),
  }),
  handle(async (req, res) => {
    const identity = await mettreAJourIdentite(getAuthenticatedUserId(req), req.body);
    res.status(200).json({ identity });
  })
);

// --- Access codes, issued by the school -------------------------------------

router.post(
  "/access-codes",
  contentRateLimiter,
  validate({ body: issueAccessCodeSchema }),
  handle(async (req, res) => {
    const actorId = getAuthenticatedUserId(req);
    const { organizationId } = await requireOrgAdmin(actorId);
    const code = await issueAccessCode(organizationId, actorId, req.body);
    res.status(201).json({ code });
  })
);

router.get(
  "/access-codes",
  validate({ query: listAccessCodesQuerySchema }),
  handle(async (req, res) => {
    const { organizationId } = await requireOrgAdmin(getAuthenticatedUserId(req));
    const codes = await listAccessCodes(organizationId, req.query as never);
    res.status(200).json({ codes });
  })
);

/**
 * Bulk issue. Answers 207 rather than 201: a partial success is the normal
 * outcome for a real school export, and reporting it as a plain success would
 * hide the rows that failed.
 */
router.post(
  "/access-codes/bulk",
  contentRateLimiter,
  validate({ body: bulkAccessCodeSchema }),
  handle(async (req, res) => {
    const actorId = getAuthenticatedUserId(req);
    const { organizationId } = await requireOrgAdmin(actorId);
    const result = await issueAccessCodesInBulk(organizationId, actorId, req.body.rows);
    res.status(result.failed.length > 0 ? 207 : 201).json(result);
  })
);

router.delete(
  "/access-codes/:id",
  validate({ params: codeIdParamSchema }),
  handle(async (req, res) => {
    const actorId = getAuthenticatedUserId(req);
    const { organizationId } = await requireOrgAdmin(actorId);
    const code = await revokeAccessCode(organizationId, req.params.id as string, actorId);
    res.status(200).json({ code });
  })
);

export default router;
