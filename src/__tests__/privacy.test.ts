import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import { prisma } from "../utils/prisma";
import { cleanupTestUsers, uniqueTestEmail } from "./helpers";

// GDPR rights are legal obligations, not features: these tests are here so a
// refactor cannot quietly break the right to access or the right to erasure.

interface TestUser {
  id: string;
  token: string;
  email: string;
}

const registerUser = async (firstName: string): Promise<TestUser> => {
  const email = uniqueTestEmail();
  const res = await request(app)
    .post("/auth/register")
    .send({ email, password: "correct-horse-battery-staple", firstName, lastName: "Privacy" });

  return { id: res.body.user.id as string, token: res.body.token as string, email };
};

describe("Data export", () => {
  let user: TestUser;

  beforeAll(async () => {
    user = await registerUser("Elena");
  });

  afterAll(async () => {
    await cleanupTestUsers();
    await prisma.$disconnect();
  });

  it("requires authentication", async () => {
    const res = await request(app).get("/users/me/export");
    expect(res.status).toBe(401);
  });

  it("returns the caller's own account data", async () => {
    const res = await request(app)
      .get("/users/me/export")
      .set("Authorization", `Bearer ${user.token}`);

    expect(res.status).toBe(200);
    expect(res.body.account.id).toBe(user.id);
    expect(res.body.account.email).toBe(user.email);
    expect(res.body.exportedAt).toBeTruthy();
  });

  it("includes every category of personal data", async () => {
    const res = await request(app)
      .get("/users/me/export")
      .set("Authorization", `Bearer ${user.token}`);

    for (const key of [
      "skillsOffered",
      "learningGoals",
      "schoolMemberships",
      "sessionsAsTeacher",
      "sessionsAsLearner",
      "messagesSent",
      "creditTransactions",
      "ratingsGiven",
      "reportsFiled",
      "appeals",
      "blockedUsers",
      "legalAcceptances",
    ]) {
      expect(res.body).toHaveProperty(key);
    }
  });

  it("never exposes the password hash", async () => {
    const res = await request(app)
      .get("/users/me/export")
      .set("Authorization", `Bearer ${user.token}`);

    expect(JSON.stringify(res.body)).not.toContain("passwordHash");
  });

  it("is offered as a downloadable file", async () => {
    const res = await request(app)
      .get("/users/me/export")
      .set("Authorization", `Bearer ${user.token}`);

    expect(res.headers["content-disposition"]).toContain("attachment");
  });
});

describe("Account deletion", () => {
  let user: TestUser;
  let other: TestUser;

  beforeAll(async () => {
    user = await registerUser("Dana");
    other = await registerUser("Otto");
  });

  afterAll(async () => {
    await cleanupTestUsers();
  });

  it("requires authentication", async () => {
    const res = await request(app).delete("/users/me");
    expect(res.status).toBe(401);
  });

  it("refuses an irreversible deletion without the password", async () => {
    // The service took a password and ignored it, so an unlocked phone was
    // enough to erase somebody's account permanently.
    const res = await request(app)
      .delete("/users/me")
      .set("Authorization", `Bearer ${user.token}`)
      .send({});

    expect(res.status).toBe(403);

    const stillActive = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { status: true },
    });
    expect(stillActive.status).toBe("ACTIVE");
  });

  it("refuses a deletion with the wrong password", async () => {
    const res = await request(app)
      .delete("/users/me")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ password: "pas-le-bon-mot-de-passe" });

    expect(res.status).toBe(403);
  });

  it("anonymises the account rather than leaving identifying data behind", async () => {
    await prisma.user.update({
      where: { id: user.id },
      data: { bio: "Something personal about me", avatarUrl: "https://example.com/me.png" },
    });

    const res = await request(app)
      .delete("/users/me")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ password: "correct-horse-battery-staple" });

    expect(res.status).toBe(204);

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { status: true, email: true, firstName: true, bio: true, avatarUrl: true },
    });

    expect(after.status).toBe("DELETED");
    expect(after.email).not.toBe(user.email);
    expect(after.email).toContain("@deleted.invalid");
    expect(after.bio).toBeNull();
    expect(after.avatarUrl).toBeNull();
  });

  it("locks the deleted account out immediately", async () => {
    const res = await request(app)
      .get("/users/me")
      .set("Authorization", `Bearer ${user.token}`);

    expect(res.status).toBe(401);
  });

  it("frees the email address for reuse", async () => {
    // A deleted account must not permanently squat an address.
    const res = await request(app)
      .post("/auth/register")
      .send({
        email: user.email,
        password: "correct-horse-battery-staple",
        firstName: "Dana",
        lastName: "Again",
      });

    expect(res.status).toBe(201);
  });

  it("refuses to delete an already deleted account", async () => {
    const res = await request(app)
      .delete("/users/me")
      .set("Authorization", `Bearer ${user.token}`);

    // The token no longer authenticates, so the request cannot reach deletion.
    expect(res.status).toBe(401);
  });

  it("leaves the other party's account untouched", async () => {
    const stillThere = await prisma.user.findUniqueOrThrow({
      where: { id: other.id },
      select: { status: true, email: true },
    });

    expect(stillThere.status).toBe("ACTIVE");
    expect(stillThere.email).toBe(other.email);
  });
});
