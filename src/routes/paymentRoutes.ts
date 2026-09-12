import express, { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import type Stripe from "stripe";
import { authenticate } from "../middleware/authMiddleware";
import { validate } from "../middleware/validate";
import { contentRateLimiter } from "../middleware/rateLimit";
import { getAuthenticatedUserId } from "../utils/requestHelpers";
import { logger } from "../utils/logger";
import { prisma } from "../utils/prisma";
import { apercuAchat, crediterAchat, CREDIT_PACKS } from "../services/creditPacksService";
import {
  creerSessionAchatCredits,
  lireEvenement,
  paiementDisponible,
} from "../services/stripeService";

const handle =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await fn(req, res);
    } catch (error) {
      next(error);
    }
  };

/**
 * La notification de paiement, sur son propre routeur.
 *
 * Elle doit etre montee **avant** le parseur JSON de l'application : Stripe
 * signe le corps brut, et une signature calculee sur un objet deja parse puis
 * reserialise ne correspondra jamais. C'est l'erreur classique de cette
 * integration, et elle se manifeste par un « signature invalide » permanent
 * qu'aucune relecture du secret n'explique.
 */
export const stripeWebhookRouter = Router();

stripeWebhookRouter.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  handle(async (req, res) => {
    const signature = req.headers["stripe-signature"];
    if (typeof signature !== "string") {
      res.status(400).json({ message: "Signature absente" });
      return;
    }

    const evenement = lireEvenement(req.body as Buffer, signature);

    if (evenement.type === "checkout.session.completed") {
      const session = evenement.data.object as Stripe.Checkout.Session;
      const { userId, packId, kind } = session.metadata ?? {};

      if (kind === "credits" && userId && packId) {
        const resultat = await crediterAchat({
          userId,
          packId,
          // L'identifiant de session rend l'operation rejouable sans danger :
          // Stripe reessaie ses notifications jusqu'a recevoir un accuse.
          reference: session.id,
          provider: "stripe",
          amountCents: session.amount_total ?? 0,
        });

        logger.info(
          { userId, packId, credited: resultat.credited, rejoue: resultat.alreadyProcessed },
          "Achat de credits credite"
        );
      }
    }

    // Toujours 200 quand l'evenement a ete lu : un code d'erreur ferait
    // reessayer Stripe en boucle pour un evenement qu'on a deja traite ou qui
    // ne nous concerne pas.
    res.status(200).json({ received: true });
  })
);

// --- Ce qui demande un compte -----------------------------------------------

const router = Router();
router.use(authenticate);

/**
 * Les lots proposes, avec ce que chacun ferait au compte du demandeur.
 *
 * Le prix vient du serveur et jamais du client : un tarif choisi par
 * l'application serait un tarif negociable.
 */
router.get(
  "/credit-packs",
  handle(async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { credits: true, creditCap: true },
    });

    const packs = await Promise.all(
      CREDIT_PACKS.map(async (pack) => {
        const apercu = await apercuAchat(userId, pack.id);
        return {
          ...pack,
          // Ce que l'achat laisse durablement : la capacite, qui survit a la
          // depense des credits eux-memes.
          plafondApres: apercu.plafondApres,
          gainDePlafond: apercu.plafondApres - apercu.plafondAvant,
        };
      })
    );

    res.status(200).json({
      packs,
      credits: user.credits,
      creditCap: user.creditCap,
      available: paiementDisponible(),
    });
  })
);

/**
 * Ouvre une page de paiement et renvoie son adresse.
 *
 * L'application l'ouvre dans le navigateur. Rien n'est credite ici : seule la
 * notification signee de Stripe verse les credits, ce qui rend sans effet une
 * adresse de succes fabriquee a la main.
 */
router.post(
  "/credit-packs/:packId/checkout",
  contentRateLimiter,
  validate({ params: z.object({ packId: z.string().min(1).max(40) }) }),
  handle(async (req, res) => {
    const userId = getAuthenticatedUserId(req);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true },
    });

    const session = await creerSessionAchatCredits({
      userId,
      email: user.email,
      packId: req.params.packId as string,
    });

    res.status(200).json(session);
  })
);

export default router;
