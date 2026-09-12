import Stripe from "stripe";
import { env } from "../utils/env";
import { logger } from "../utils/logger";
import { HttpError } from "../utils/httpError";
import { CREDIT_PACKS, packById } from "./creditPacksService";

/**
 * Le paiement, chez Stripe.
 *
 * On utilise la page de paiement **hebergee par Stripe** plutot qu'un formulaire
 * maison. Trois raisons, dans cet ordre :
 *
 * - aucune donnee de carte ne touche jamais ce serveur, ce qui retire
 *   l'essentiel de la charge PCI ;
 * - il n'y a aucune page a construire, ni sur le site ni dans l'application :
 *   on ouvre une adresse dans le navigateur ;
 * - c'est ce qui permet de vendre depuis le mobile sans passer par les
 *   boutiques. Un paiement effectue dans le navigateur echappe a la commission
 *   d'Apple et de Google, qui ne porte que sur ce qui se paie *dans*
 *   l'application -- et le DMA europeen autorise explicitement d'y renvoyer
 *   depuis l'app.
 */

const configure = (): boolean => Boolean(env.stripeSecretKey);

let client: Stripe | null = null;

const stripe = (): Stripe => {
  if (!env.stripeSecretKey) {
    throw new HttpError(
      503,
      "Le paiement n'est pas configure sur ce serveur (STRIPE_SECRET_KEY absente)"
    );
  }
  // Une seule instance : chacune ouvre son propre pool de connexions.
  client ??= new Stripe(env.stripeSecretKey);
  return client;
};

/** Ce que le client peut savoir sans qu'on lui expose la configuration. */
export const paiementDisponible = (): boolean => configure();

/**
 * Ouvre une session de paiement pour un lot de credits.
 *
 * `userId` et `packId` voyagent dans les metadonnees et non dans l'URL de
 * retour : c'est la notification signee de Stripe qui credite le compte, jamais
 * le retour du navigateur. Quelqu'un qui fabriquerait l'adresse de succes a la
 * main n'obtiendrait donc rien.
 */
export const creerSessionAchatCredits = async (input: {
  userId: string;
  email: string;
  packId: string;
}) => {
  const pack = packById(input.packId);
  const base = env.frontendUrl.replace(/\/$/, "");

  const session = await stripe().checkout.sessions.create({
    mode: "payment",
    customer_email: input.email,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: pack.currency,
          unit_amount: pack.priceCents,
          product_data: {
            name: `${pack.credits} credits SkillBridge`,
            description: `${pack.label} d'apprentissage. ${pack.hint}.`,
          },
        },
      },
    ],
    // Lues par le webhook. Le retour navigateur ne credite rien.
    metadata: { userId: input.userId, packId: pack.id, kind: "credits" },
    success_url: `${base}/paiement/merci?session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/paiement/annule`,
    locale: "fr",
  });

  if (!session.url) {
    throw new HttpError(502, "Stripe n'a pas renvoye d'adresse de paiement");
  }

  return { url: session.url, sessionId: session.id };
};

/**
 * Verifie qu'une notification vient bien de Stripe.
 *
 * Sans cette verification, n'importe qui pourrait appeler le webhook et
 * s'attribuer des credits : c'est une route publique, par construction. La
 * signature est calculee sur le **corps brut** -- si un middleware a parse le
 * JSON avant, elle ne correspondra jamais.
 */
export const lireEvenement = (corpsBrut: Buffer, signature: string): Stripe.Event => {
  if (!env.stripeWebhookSecret) {
    throw new HttpError(503, "STRIPE_WEBHOOK_SECRET absente : notifications refusees");
  }

  try {
    return stripe().webhooks.constructEvent(corpsBrut, signature, env.stripeWebhookSecret);
  } catch (error) {
    logger.warn({ err: error }, "Signature Stripe invalide");
    throw new HttpError(400, "Signature invalide");
  }
};

/** Les lots, tels qu'ils sont proposes. Le prix vient du serveur, jamais du client. */
export const listerLots = () => CREDIT_PACKS;
