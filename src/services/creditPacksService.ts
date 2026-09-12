import { Prisma } from "@prisma/client";
import { prisma } from "../utils/prisma";
import { HttpError } from "../utils/httpError";
import { arrondirPlafond } from "./creditService";

/**
 * Les lots de credits, et ce qu'un achat produit.
 *
 * Ce fichier ne sait rien de Stripe, d'Apple ni de Google. Un credit achete est
 * un credit achete : seul change qui confirme le paiement. C'est ce qui permet
 * de brancher l'achat natif plus tard sans rien reprendre ici.
 *
 * ## Pourquoi ces prix
 *
 * Un credit vaut une minute d'enseignement. Une heure de cours particulier se
 * paie 20 a 40 euros en France ; un lot d'une heure a 4,99 EUR se place bien en
 * dessous, ce qui est correct : on achete un jeton d'echange entre pairs, pas
 * l'heure d'un professeur diplome.
 *
 * Le prix doit rester assez haut pour qu'enseigner reste plus interessant
 * qu'acheter -- sinon plus personne n'enseigne et la plateforme n'a plus rien a
 * vendre -- et assez bas pour qu'on l'achete sans reflechir. La degressivite
 * recompense l'engagement sans jamais descendre sous le seuil ou gagner ses
 * credits perdrait son sens.
 */

export interface CreditPack {
  id: string;
  credits: number;
  /** En centimes : la monnaie ne se represente jamais en nombre a virgule. */
  priceCents: number;
  currency: "eur";
  label: string;
  hint: string;
  /** Mis en avant dans l'interface. Un seul, sinon l'accent ne distingue rien. */
  featured?: boolean;
}

export const CREDIT_PACKS: CreditPack[] = [
  {
    id: "decouverte",
    credits: 60,
    priceCents: 499,
    currency: "eur",
    label: "1 heure",
    hint: "De quoi suivre un cours sans attendre",
  },
  {
    id: "essentiel",
    credits: 180,
    priceCents: 1199,
    currency: "eur",
    label: "3 heures",
    hint: "Le meilleur rapport pour apprendre regulierement",
    featured: true,
  },
  {
    id: "grand",
    credits: 420,
    priceCents: 2499,
    currency: "eur",
    label: "7 heures",
    hint: "Pour un projet entier, ou une periode de revisions",
  },
];

export const packById = (id: string): CreditPack => {
  const pack = CREDIT_PACKS.find((p) => p.id === id);
  if (!pack) throw new HttpError(400, "Ce lot de credits n'existe pas");
  return pack;
};

/**
 * Ce qu'un lot fait au compte, calcule avant l'achat.
 *
 * Sert a montrer le benefice reel : « ton plafond passera de 500 a 700 » est
 * plus parlant que « +180 credits », et c'est la partie que l'acheteur garde
 * apres avoir depense ce qu'il a achete.
 */
export const apercuAchat = async (userId: string, packId: string) => {
  const pack = packById(packId);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { credits: true, creditCap: true },
  });
  if (!user) throw new HttpError(404, "Compte introuvable");

  const soldeApres = user.credits + pack.credits;

  return {
    pack,
    creditsAvant: user.credits,
    creditsApres: soldeApres,
    plafondAvant: user.creditCap,
    plafondApres: Math.max(user.creditCap, arrondirPlafond(soldeApres)),
  };
};

/**
 * Verse un lot paye, une seule fois.
 *
 * L'unicite est portee par la base -- `@@unique([provider, reference])` -- et
 * non par une lecture prealable. La difference compte : un prestataire de
 * paiement rejoue ses notifications, Stripe explicitement et plusieurs fois
 * jusqu'a recevoir un accuse, et deux notifications arrivees en meme temps
 * passeraient toutes les deux un simple « est-ce que ca existe deja ? ». Seule
 * une contrainte empeche reellement le double versement.
 *
 * Le plafond monte avec le solde et n'en redescend pas : c'est la partie de
 * l'achat qui survit a la depense. On enregistre sa valeur avant et apres, pour
 * qu'une reclamation reste verifiable un an plus tard.
 */
export const crediterAchat = async (input: {
  userId: string;
  packId: string;
  reference: string;
  provider: "stripe" | "apple" | "google";
  amountCents: number;
}) => {
  const pack = packById(input.packId);

  try {
    return await prisma.$transaction(async (tx) => {
      const avant = await tx.user.findUnique({
        where: { id: input.userId },
        select: { credits: true, creditCap: true },
      });
      if (!avant) throw new HttpError(404, "Compte introuvable");

      const rows = await tx.$queryRaw<Array<{ credits: number; creditCap: number }>>(
        Prisma.sql`
          UPDATE "User"
          SET "creditCap" = GREATEST("creditCap", CEIL(("credits" + ${pack.credits})::numeric / 100) * 100),
              "credits"   = "credits" + ${pack.credits}
          WHERE "id" = ${input.userId}
          RETURNING "credits", "creditCap"
        `
      );
      const apres = rows[0]!;

      // La creation echoue si ce paiement a deja ete credite, ce qui annule
      // tout le versement ci-dessus. C'est exactement le comportement voulu.
      await tx.creditPurchase.create({
        data: {
          userId: input.userId,
          packId: pack.id,
          credits: pack.credits,
          amountCents: input.amountCents,
          currency: pack.currency,
          provider: input.provider,
          reference: input.reference,
          capBefore: avant.creditCap,
          capAfter: apres.creditCap,
        },
      });

      // Double ecriture assumee : la table d'achats porte la comptabilite,
      // l'historique de transactions reste ce que l'utilisateur lit dans
      // l'application a cote de ses sessions.
      await tx.rewardTransaction.create({
        data: {
          userId: input.userId,
          amount: pack.credits,
          type: "EARNED",
          description: `Achat de ${pack.credits} credits`,
        },
      });

      return { ...apres, credited: pack.credits, alreadyProcessed: false };
    });
  } catch (error) {
    // P2002 : violation d'unicite, donc notification rejouee. On repond sans
    // rien refaire, pour que le prestataire cesse de reessayer.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const u = await prisma.user.findUniqueOrThrow({
        where: { id: input.userId },
        select: { credits: true, creditCap: true },
      });
      return { ...u, credited: 0, alreadyProcessed: true };
    }
    throw error;
  }
};

/**
 * L'historique d'achats d'un compte, et ce qu'il a coute.
 *
 * Repond a « qui a achete quoi, quand, et combien il a paye » -- ce qu'un
 * libelle de transaction ne savait pas dire.
 */
export const achatsDuCompte = (userId: string) =>
  prisma.creditPurchase.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      packId: true,
      credits: true,
      amountCents: true,
      currency: true,
      provider: true,
      status: true,
      capBefore: true,
      capAfter: true,
      createdAt: true,
      refundedAt: true,
    },
  });
