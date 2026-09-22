import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import { prisma } from "../utils/prisma";
import { cleanupTestUsers, uniqueTestEmail } from "./helpers";

// Authorization state is read from the database on every request, so suspending
// an account must take effect immediately rather than when its token expires.

describe("Suspended accounts", () => {
  let userId: string;
  let token: string;

  beforeAll(async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({
        email: uniqueTestEmail(),
        password: "correct-horse-battery-staple",
        firstName: "Sam",
        lastName: "Suspended",
      });

    userId = res.body.user.id as string;
    token = res.body.token as string;
  });

  afterAll(async () => {
    await cleanupTestUsers();
    await prisma.$disconnect();
  });

  it("accepts the token while the account is active", async () => {
    const res = await request(app)
      .get("/users/me")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it("rejects an already-issued token as soon as the account is suspended", async () => {
    await prisma.user.update({
      where: { id: userId },
      data: {
        status: "SUSPENDED",
        suspendedAt: new Date(),
        suspensionReason: "Repeated harassment reports",
      },
    });

    const res = await request(app)
      .get("/users/me")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it("tells the suspended user why and where to appeal", async () => {
    const res = await request(app)
      .get("/users/me")
      .set("Authorization", `Bearer ${token}`);

    // A bare "invalid token" would be misleading, and under the DSA a sanction
    // has to come with a statement of reasons and a route of appeal.
    expect(res.body.message).toBe("Your account is suspended.");
    expect(res.body.reason).toBe("Repeated harassment reports");
    expect(res.body.appealPath).toBe("/appeals");
  });

  it("accepts the token again once the suspension is lifted", async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { status: "ACTIVE", suspendedAt: null, suspensionReason: null },
    });

    const res = await request(app)
      .get("/users/me")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
  });
});
