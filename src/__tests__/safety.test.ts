import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import { prisma } from "../utils/prisma";
import { cleanupTestUsers, uniqueTestEmail } from "./helpers";

/**
 * The defects an audit found by exercising the running API rather than reading
 * it: a block that blocked nothing, a member directory of minors served without
 * a token, a credit loop through self-sessions, and credits trapped in a booking
 * that could not be cancelled.
 *
 * Each test below reproduces the exploit as it was actually performed, so a
 * regression fails here rather than in production.
 */

interface TestUser {
  id: string;
  token: string;
  email: string;
}

const registerUser = async (firstName: string): Promise<TestUser> => {
  const email = uniqueTestEmail();
  const res = await request(app).post("/auth/register").send({
    email,
    password: "correct-horse-battery-staple",
    firstName,
    lastName: "Surete",
  });

  return { id: res.body.user.id as string, token: res.body.token as string, email };
};

describe("Safety fixes", () => {
  let alice: TestUser;
  let mallory: TestUser;

  beforeAll(async () => {
    alice = await registerUser("Alice");
    mallory = await registerUser("Mallory");
  });

  afterAll(async () => {
    await cleanupTestUsers();
    await prisma.$disconnect();
  });

  describe("the member directory is not public", () => {
    it("refuses an anonymous search", async () => {
      // This returned every active account's name, bio, skills, rating and
      // weekly availability with no token at all.
      const res = await request(app).get("/users/search?q=a");
      expect(res.status).toBe(401);
    });

    it("refuses an anonymous profile read", async () => {
      const res = await request(app).get(`/users/${alice.id}`);
      expect(res.status).toBe(401);
    });

    it("still serves a signed-in member", async () => {
      const res = await request(app)
        .get("/users/search?q=a")
        .set("Authorization", `Bearer ${alice.token}`);
      expect(res.status).toBe(200);
    });
  });

  describe("blocking actually blocks", () => {
    beforeAll(async () => {
      const res = await request(app)
        .post(`/users/${mallory.id}/block`)
        .set("Authorization", `Bearer ${alice.token}`)
        .send({});

      // The route exists under moderation; if the shape differs the block is
      // written directly so the enforcement tests still mean something.
      if (res.status >= 400) {
        await prisma.userBlock.create({
          data: { blockerId: alice.id, blockedId: mallory.id },
        });
      }
    });

    it("stops the blocked account sending a connection request", async () => {
      // Verified by the audit as returning 201 before this fix.
      const res = await request(app)
        .post("/matches/request")
        .set("Authorization", `Bearer ${mallory.token}`)
        .send({ receiverId: alice.id, message: "Bonjour" });

      expect(res.status).toBe(403);
    });

    it("stops the blocked account reading the blocker's profile", async () => {
      const res = await request(app)
        .get(`/users/${alice.id}`)
        .set("Authorization", `Bearer ${mallory.token}`);

      // 404, not 403: whether a block exists is not something the blocked
      // person gets to confirm.
      expect(res.status).toBe(404);
    });

    it("removes each from the other's search results", async () => {
      const asMallory = await request(app)
        .get("/users/search?q=Alice")
        .set("Authorization", `Bearer ${mallory.token}`);
      expect(asMallory.status).toBe(200);
      expect(asMallory.body.users.some((u: { id: string }) => u.id === alice.id)).toBe(false);

      // Symmetric: blocking someone removes them from your own experience too.
      const asAlice = await request(app)
        .get("/users/search?q=Mallory")
        .set("Authorization", `Bearer ${alice.token}`);
      expect(asAlice.body.users.some((u: { id: string }) => u.id === mallory.id)).toBe(false);
    });

    it("stops a message being sent between them", async () => {
      const conversation = await prisma.conversation.create({
        data: { firstUserId: alice.id, secondUserId: mallory.id },
      });

      const res = await request(app)
        .post(`/conversations/${conversation.id}/messages`)
        .set("Authorization", `Bearer ${mallory.token}`)
        .send({ body: "Tu ne peux pas m'echapper" });

      expect(res.status).toBe(403);
    });

    it("stops a session being booked between them", async () => {
      const res = await request(app)
        .post("/sessions")
        .set("Authorization", `Bearer ${mallory.token}`)
        .send({
          learnerId: alice.id,
          title: "Session non desiree",
          estimatedDuration: 30,
          scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
        });

      expect(res.status).toBe(403);
    });
  });

  describe("no credit factory", () => {
    it("refuses a session where teacher and learner are the same person", async () => {
      // The loop: create, accept, join and end a session with yourself. The
      // balance nets out, but each pass added a COMPLETED session, and the
      // loyalty reward counts completed sessions without filtering.
      const res = await request(app)
        .post("/sessions")
        .set("Authorization", `Bearer ${alice.token}`)
        .send({
          learnerId: alice.id,
          title: "Auto-session",
          estimatedDuration: 60,
          scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
        });

      expect(res.status).toBe(400);
    });
  });

  describe("credits are not trapped in a booking", () => {
    it("cancels an accepted session and gives the credits back", async () => {
      const teacher = await registerUser("Tomas");
      const learner = await registerUser("Lena");

      const created = await request(app)
        .post("/sessions")
        .set("Authorization", `Bearer ${teacher.token}`)
        .send({
          learnerId: learner.id,
          title: "Session a annuler",
          estimatedDuration: 30,
          scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
        });
      expect(created.status).toBe(201);
      const sessionId = created.body.session.id as string;

      const before = await prisma.user.findUniqueOrThrow({
        where: { id: learner.id },
        select: { credits: true },
      });

      const accepted = await request(app)
        .post(`/sessions/${sessionId}/accept`)
        .set("Authorization", `Bearer ${learner.token}`);
      expect(accepted.status).toBe(200);

      const afterAccept = await prisma.user.findUniqueOrThrow({
        where: { id: learner.id },
        select: { credits: true },
      });
      expect(afterAccept.credits).toBe(before.credits - 30);

      // Before this fix there was no way out: `refuse` only accepts a pending
      // session and `end` only an active one, so the credits stayed spent.
      const cancelled = await request(app)
        .post(`/sessions/${sessionId}/cancel`)
        .set("Authorization", `Bearer ${learner.token}`);

      expect(cancelled.status).toBe(200);
      expect(cancelled.body.status).toBe("CANCELLED");

      const afterCancel = await prisma.user.findUniqueOrThrow({
        where: { id: learner.id },
        select: { credits: true },
      });
      expect(afterCancel.credits).toBe(before.credits);
    });

    it("lets the teacher call off a booking too", async () => {
      const teacher = await registerUser("Theo");
      const learner = await registerUser("Lise");

      const created = await request(app)
        .post("/sessions")
        .set("Authorization", `Bearer ${teacher.token}`)
        .send({
          learnerId: learner.id,
          title: "Annulee par le professeur",
          estimatedDuration: 20,
          scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
        });

      const res = await request(app)
        .post(`/sessions/${created.body.session.id}/cancel`)
        .set("Authorization", `Bearer ${teacher.token}`);

      expect(res.status).toBe(200);
    });

    it("refuses a cancellation from someone who is not in the session", async () => {
      const teacher = await registerUser("Tania");
      const learner = await registerUser("Louis");
      const created = await request(app)
        .post("/sessions")
        .set("Authorization", `Bearer ${teacher.token}`)
        .send({
          learnerId: learner.id,
          title: "Session privee",
          estimatedDuration: 20,
          scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
        });

      const res = await request(app)
        .post(`/sessions/${created.body.session.id}/cancel`)
        .set("Authorization", `Bearer ${alice.token}`);

      expect(res.status).toBe(403);
    });
  });

  describe("profile image addresses are validated", () => {
    it("refuses a javascript: avatar", async () => {
      // Accepted and stored before: same kind of data as a chat attachment,
      // which was validated strictly, but under no rule at all.
      const res = await request(app)
        .patch("/users/me")
        .set("Authorization", `Bearer ${alice.token}`)
        .send({ avatarUrl: "javascript:alert(document.cookie)" });

      expect(res.status).toBe(400);

      const stored = await prisma.user.findUniqueOrThrow({
        where: { id: alice.id },
        select: { avatarUrl: true },
      });
      expect(stored.avatarUrl ?? "").not.toContain("javascript:");
    });

    it("refuses a plain http banner", async () => {
      const res = await request(app)
        .patch("/users/me")
        .set("Authorization", `Bearer ${alice.token}`)
        .send({ bannerUrl: "http://exemple.fr/banniere.png" });

      expect(res.status).toBe(400);
    });

    it("accepts an upload served by this API", async () => {
      const res = await request(app)
        .patch("/users/me")
        .set("Authorization", `Bearer ${alice.token}`)
        .send({ avatarUrl: "/uploads/avatars/avatar-abc123.webp" });

      expect(res.status).toBe(200);
    });

    it("accepts an https address", async () => {
      const res = await request(app)
        .patch("/users/me")
        .set("Authorization", `Bearer ${alice.token}`)
        .send({ avatarUrl: "https://exemple.fr/photo.png" });

      expect(res.status).toBe(200);
    });
  });
});
