import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../utils/prisma";
import { MAX_CREDITS, grantCredits, spendCredits } from "../services/creditService";
import { cleanupTestUsers, uniqueTestEmail } from "./helpers";

// These tests guard the "User_credits_bounds_check" constraint added in
// 20260608160000_enforce_credit_bounds. Any code path that writes credits with a
// raw increment/decrement instead of these helpers will fail the constraint and
// roll back its whole transaction — which previously left sessions stuck ACTIVE
// with the learner never refunded.

const createUserWithCredits = async (credits: number): Promise<string> => {
  const user = await prisma.user.create({
    data: {
      email: uniqueTestEmail(),
      passwordHash: "not-a-real-hash",
      firstName: "Credit",
      lastName: "Bounds",
      credits,
    },
    select: { id: true },
  });
  return user.id;
};

const readCredits = async (userId: string): Promise<number> => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { credits: true },
  });
  return user.credits;
};

describe("Credit bounds", () => {
  beforeEach(async () => {
    await cleanupTestUsers();
  });

  afterAll(async () => {
    await cleanupTestUsers();
    await prisma.$disconnect();
  });

  it("caps a grant at MAX_CREDITS instead of throwing", async () => {
    const userId = await createUserWithCredits(MAX_CREDITS - 5);

    await prisma.$transaction((tx) => grantCredits(tx, userId, 20));

    expect(await readCredits(userId)).toBe(MAX_CREDITS);
  });

  it("keeps a grant that stays under the cap exact", async () => {
    const userId = await createUserWithCredits(100);

    await prisma.$transaction((tx) => grantCredits(tx, userId, 25));

    expect(await readCredits(userId)).toBe(125);
  });

  it("is a no-op when the balance is already at the cap", async () => {
    const userId = await createUserWithCredits(MAX_CREDITS);

    await prisma.$transaction((tx) => grantCredits(tx, userId, 50));

    expect(await readCredits(userId)).toBe(MAX_CREDITS);
  });

  it("rejects a spend larger than the balance without going negative", async () => {
    const userId = await createUserWithCredits(10);

    await expect(
      prisma.$transaction((tx) => spendCredits(tx, userId, 40))
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(await readCredits(userId)).toBe(10);
  });

  it("rejects concurrent spends that would overdraw the balance", async () => {
    const userId = await createUserWithCredits(30);

    // Both spends individually fit the balance; only one may succeed.
    const results = await Promise.allSettled([
      prisma.$transaction((tx) => spendCredits(tx, userId, 20)),
      prisma.$transaction((tx) => spendCredits(tx, userId, 20)),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    expect(await readCredits(userId)).toBe(10);
  });
});
