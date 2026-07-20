"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.spendCredits = exports.grantCreditsWithActualAmount = exports.grantCredits = exports.MAX_CREDITS = void 0;
const client_1 = require("@prisma/client");
const httpError_1 = require("../utils/httpError");
exports.MAX_CREDITS = 500;
const validateCreditAmount = (amount) => {
    if (!Number.isInteger(amount) || amount < 0) {
        throw new httpError_1.HttpError(400, "Credit amount must be a non-negative integer");
    }
};
const grantCredits = async (transaction, userId, amount) => {
    validateCreditAmount(amount);
    const users = await transaction.$queryRaw(client_1.Prisma.sql `
      UPDATE "User"
      SET "credits" = LEAST(${exports.MAX_CREDITS}, "credits" + ${amount})
      WHERE "id" = ${userId}
      RETURNING "credits"
    `);
    if (!users[0]) {
        throw new httpError_1.HttpError(404, "User not found");
    }
    return users[0].credits;
};
exports.grantCredits = grantCredits;
const grantCreditsWithActualAmount = async (transaction, userId, amount) => {
    validateCreditAmount(amount);
    const users = await transaction.$queryRaw(client_1.Prisma.sql `
      SELECT "credits"
      FROM "User"
      WHERE "id" = ${userId}
      FOR UPDATE
    `);
    if (!users[0]) {
        throw new httpError_1.HttpError(404, "User not found");
    }
    const currentCredits = users[0].credits;
    const nextCredits = Math.min(exports.MAX_CREDITS, currentCredits + amount);
    if (nextCredits !== currentCredits) {
        await transaction.user.update({
            where: { id: userId },
            data: { credits: nextCredits },
        });
    }
    return nextCredits - currentCredits;
};
exports.grantCreditsWithActualAmount = grantCreditsWithActualAmount;
const spendCredits = async (transaction, userId, amount) => {
    validateCreditAmount(amount);
    const users = await transaction.$queryRaw(client_1.Prisma.sql `
      UPDATE "User"
      SET "credits" = "credits" - ${amount}
      WHERE "id" = ${userId}
        AND "credits" >= ${amount}
      RETURNING "credits"
    `);
    if (!users[0]) {
        throw new httpError_1.HttpError(400, "User does not have enough credits");
    }
    return users[0].credits;
};
exports.spendCredits = spendCredits;
//# sourceMappingURL=creditService.js.map