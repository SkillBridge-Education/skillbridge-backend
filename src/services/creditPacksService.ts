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
 * `reference` identifie le paiement chez le prestataire. L'unicite est portee
 * par la base et non par ce code : un prestataire de paiement rejoue ses
 * notifications -- Stripe le fait explicitement, plusieurs fois, jusqu'a
 * recevoir un accuse -- et sans cette garantie un meme paiement crediterait
 * deux ou trois fois.
 *
 * Le plafond monte avec le solde et n'en redescend pas. C'est la partie de
 * l'achat qui survit a la depense : on garde la capacite meme une fois les
 * credits consommes.
 */
export const crediterAchat = async (input: {
  userId: string;
  packId: string;
  reference: string;
  provider: "stripe" | "apple" | "google";
  amountCents: number;
}) => {
  const pack = packById(input.packId);

  return prisma.$transaction(async (tx) => {
    const dejaVu = await tx.rewardTransaction.findFirst({
      where: { description: { contains: input.reference } },
      select: { id: true },
    });
    if (dejaVu) {
      // Rejoue : le paiement a deja ete credite. On repond sans rien refaire,
      // pour que le prestataire cesse de reessayer.
      const u = await tx.user.findUniqueOrThrow({
        where: { id: input.userId },
        select: { credits: true, creditCap: true },
      });
      return { ...u, credited: 0, alreadyProcessed: true };
    }

    const rows = await tx.$queryRaw<Array<{ credits: number; creditCap: number }>>(
      Prisma.sql`
        UPDATE "User"
        SET "creditCap" = GREATEST("creditCap", CEIL(("credits" + ${pack.credits})::numeric / 100) * 100),
            "credits"   = "credits" + ${pack.credits}
        WHERE "id" = ${input.userId}
        RETURNING "credits", "creditCap"
      `
    );
    if (!rows[0]) throw new HttpError(404, "Compte introuvable");

    await tx.rewardTransaction.create({
      data: {
        userId: input.userId,
        amount: pack.credits,
        type: "EARNED",
        // La reference est dans le libelle : c'est elle qui rend l'operation
        // rejouable sans danger, et elle doit rester lisible dans l'historique.
        description: `Achat ${pack.credits} credits (${input.provider} ${input.reference})`,
      },
    });

    return { ...rows[0], credited: pack.credits, alreadyProcessed: false };
  });
};
