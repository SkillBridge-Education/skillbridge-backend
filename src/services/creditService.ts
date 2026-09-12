import { Prisma } from "@prisma/client";
import { HttpError } from "../utils/httpError";

/**
 * Le plafond d'un compte qui n'a jamais rien achete.
 *
 * Ce n'est plus la limite absolue du systeme : chaque compte porte le sien dans
 * `User.creditCap`, et un achat le fait monter. Cette constante reste la valeur
 * de depart, et sert la ou il faut une borne avant de connaitre le compte --
 * la validation d'une reservation de session, par exemple.
 */
export const DEFAULT_CREDIT_CAP = 500;

/** @deprecated Utiliser DEFAULT_CREDIT_CAP, ou le plafond du compte concerne. */
export const MAX_CREDITS = DEFAULT_CREDIT_CAP;

/**
 * Arrondit un plafond au palier de cent superieur.
 *
 * Acheter 550 credits porte le plafond a 600 et non a 550 : un plafond qui colle
 * exactement au solde se remplirait des le premier credit gagne ensuite, et le
 * bonus de l'achat aurait disparu avant d'avoir servi.
 */
export const arrondirPlafond = (valeur: number): number => Math.ceil(valeur / 100) * 100;

const validateCreditAmount = (amount: number): void => {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new HttpError(400, "Credit amount must be a non-negative integer");
  }
};

export const grantCredits = async (
  transaction: Prisma.TransactionClient,
  userId: string,
  amount: number
): Promise<number> => {
  validateCreditAmount(amount);

  // Le plafond du compte, lu dans la meme instruction : aller le chercher
  // d'abord laisserait une fenetre ou un achat concurrent le ferait monter
  // sans que ce versement en profite.
  const users = await transaction.$queryRaw<Array<{ credits: number }>>(
    Prisma.sql`
      UPDATE "User"
      SET "credits" = LEAST("creditCap", "credits" + ${amount})
      WHERE "id" = ${userId}
      RETURNING "credits"
    `
  );

  if (!users[0]) {
    throw new HttpError(404, "User not found");
  }

  return users[0].credits;
};

export const grantCreditsWithActualAmount = async (
  transaction: Prisma.TransactionClient,
  userId: string,
  amount: number
): Promise<number> => {
  validateCreditAmount(amount);

  const users = await transaction.$queryRaw<Array<{ credits: number; creditCap: number }>>(
    Prisma.sql`
      SELECT "credits", "creditCap"
      FROM "User"
      WHERE "id" = ${userId}
      FOR UPDATE
    `
  );

  if (!users[0]) {
    throw new HttpError(404, "User not found");
  }

  const currentCredits = users[0].credits;
  const nextCredits = Math.min(users[0].creditCap, currentCredits + amount);

  if (nextCredits !== currentCredits) {
    await transaction.user.update({
      where: { id: userId },
      data: { credits: nextCredits },
    });
  }

  return nextCredits - currentCredits;
};

export const spendCredits = async (
  transaction: Prisma.TransactionClient,
  userId: string,
  amount: number
): Promise<number> => {
  validateCreditAmount(amount);

  const users = await transaction.$queryRaw<Array<{ credits: number }>>(
    Prisma.sql`
      UPDATE "User"
      SET "credits" = "credits" - ${amount}
      WHERE "id" = ${userId}
        AND "credits" >= ${amount}
      RETURNING "credits"
    `
  );

  if (!users[0]) {
    throw new HttpError(400, "User does not have enough credits");
  }

  return users[0].credits;
};
