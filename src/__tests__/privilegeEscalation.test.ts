import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import { prisma } from "../utils/prisma";
import { cleanupTestUsers, uniqueTestEmail } from "./helpers";

// Role is authorization-critical: authMiddleware re-reads it from the database on
// every request, and updateUserProfile builds its Prisma input field by field.
// These tests fail loudly if either property is ever weakened — for example by
// adding `role` to UpdateProfileInput, or by spreading the request body into the
// update payload.

describe("Profile updates cannot escalate privileges", () => {
  let userId: string;
  let token: string;

  beforeAll(async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({
        email: uniqueTestEmail(),
        password: "correct-horse-battery-staple",
        firstName: "Mallory",
        lastName: "Escalation",
      });

    userId = res.body.user.id as string;
    token = res.body.token as string;
  });

  afterAll(async () => {
    await cleanupTestUsers();
    await prisma.$disconnect();
  });

  it("registers new accounts as USER", async () => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { role: true },
    });

    expect(user.role).toBe("USER");
  });

  it("ignores a role field sent to PATCH /users/me", async () => {
    const res = await request(app)
      .patch("/users/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ bio: "Just a normal user", role: "ADMIN" });

    expect(res.status).toBe(200);

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { role: true, bio: true },
    });

    expect(user.role).toBe("USER");
    // The legitimate part of the payload must still be applied.
    expect(user.bio).toBe("Just a normal user");
  });

  it("ignores a role field sent to PUT /users/me", async () => {
    const res = await request(app)
      .put("/users/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ firstName: "Mallory", lastName: "Escalation", role: "ADMIN" });

    expect(res.status).toBe(200);

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { role: true },
    });

    expect(user.role).toBe("USER");
  });

  it("ignores a credits field sent to PATCH /users/me", async () => {
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { credits: true },
    });

    await request(app)
      .patch("/users/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ credits: 500 });

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { credits: true },
    });

    expect(after.credits).toBe(before.credits);
  });
});
