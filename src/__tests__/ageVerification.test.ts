import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import { prisma } from "../utils/prisma";
import { MINIMUM_AGE_YEARS } from "../utils/profileValidation";
import { cleanupTestUsers, uniqueTestEmail } from "./helpers";

// France sets the age of digital consent at 15. Below it a parent must consent,
// which this service cannot collect, so the gate has to actually hold.

const yearsAgo = (years: number, extraDays = 0): string => {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);
  date.setDate(date.getDate() - extraDays);
  return date.toISOString();
};

const registerUser = async (): Promise<{ id: string; token: string }> => {
  const res = await request(app)
    .post("/auth/register")
    .send({
      email: uniqueTestEmail(),
      password: "correct-horse-battery-staple",
      firstName: "Age",
      lastName: "Check",
    });

  return { id: res.body.user.id as string, token: res.body.token as string };
};

const setDateOfBirth = (token: string, dateOfBirth: string) =>
  request(app)
    .patch("/users/me")
    .set("Authorization", `Bearer ${token}`)
    .send({ dateOfBirth });

describe("Age verification", () => {
  let user: { id: string; token: string };

  beforeEach(async () => {
    await cleanupTestUsers();
    user = await registerUser();
  });

  afterAll(async () => {
    await cleanupTestUsers();
    await prisma.$disconnect();
  });

  it("records a date of birth above the minimum age", async () => {
    const res = await setDateOfBirth(user.token, yearsAgo(MINIMUM_AGE_YEARS + 2));

    expect(res.status).toBe(200);

    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { dateOfBirth: true },
    });
    expect(stored.dateOfBirth).not.toBeNull();
  });

  it("refuses someone below the minimum age", async () => {
    const res = await setDateOfBirth(user.token, yearsAgo(MINIMUM_AGE_YEARS - 1));

    expect(res.status).toBe(403);

    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { dateOfBirth: true },
    });
    expect(stored.dateOfBirth).toBeNull();
  });

  it("refuses someone one day short of the minimum age", async () => {
    // The boundary is where an off-by-one in the age maths would show up.
    const res = await setDateOfBirth(user.token, yearsAgo(MINIMUM_AGE_YEARS, -1));

    expect(res.status).toBe(403);
  });

  it("accepts someone exactly at the minimum age", async () => {
    const res = await setDateOfBirth(user.token, yearsAgo(MINIMUM_AGE_YEARS, 1));

    expect(res.status).toBe(200);
  });

  it("refuses a date in the future", async () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);

    const res = await setDateOfBirth(user.token, future.toISOString());
    expect(res.status).toBe(400);
  });

  it("refuses a malformed date", async () => {
    const res = await setDateOfBirth(user.token, "not-a-date");
    expect(res.status).toBe(400);
  });

  it("refuses to change a date of birth once recorded", async () => {
    // Otherwise the gate is decorative: sign up as 16, then set anything.
    await setDateOfBirth(user.token, yearsAgo(MINIMUM_AGE_YEARS + 2));

    const res = await setDateOfBirth(user.token, yearsAgo(MINIMUM_AGE_YEARS + 10));
    expect(res.status).toBe(409);
  });

  it("still applies the minimum age when other fields are sent alongside", async () => {
    const res = await request(app)
      .patch("/users/me")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ bio: "Trying to slip it past", dateOfBirth: yearsAgo(10) });

    expect(res.status).toBe(403);

    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { bio: true, dateOfBirth: true },
    });
    // The whole request is rejected, so the bio must not have landed either.
    expect(stored.bio).toBeNull();
    expect(stored.dateOfBirth).toBeNull();
  });
});
