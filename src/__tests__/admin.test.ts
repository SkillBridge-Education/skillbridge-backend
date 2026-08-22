import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import { prisma } from "../utils/prisma";
import { cleanupTestUsers, uniqueTestEmail } from "./helpers";

// The admin surface can suspend accounts and hand out credits, so the two
// things that must never regress are the authorization wall and the audit
// trail: no privileged action may happen without a recorded reason.

interface TestUser {
  id: string;
  token: string;
}

const registerUser = async (firstName: string): Promise<TestUser> => {
  const res = await request(app)
    .post("/auth/register")
    .send({
      email: uniqueTestEmail(),
      password: "correct-horse-battery-staple",
      firstName,
      lastName: "Admin",
    });

  return { id: res.body.user.id as string, token: res.body.token as string };
};

const REASON = "Verified breach of the community rules";

describe("Admin API", () => {
  let admin: TestUser;
  let regular: TestUser;
  let victim: TestUser;

  beforeAll(async () => {
    admin = await registerUser("Ada");
    regular = await registerUser("Ronan");
    victim = await registerUser("Vera");

    await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } });
  });

  afterAll(async () => {
    await cleanupTestUsers();
    await prisma.$disconnect();
  });

  describe("authorization wall", () => {
    it("rejects an anonymous caller", async () => {
      const res = await request(app).get("/admin/users");
      expect(res.status).toBe(401);
    });

    it("rejects an authenticated non-admin", async () => {
      const res = await request(app)
        .get("/admin/users")
        .set("Authorization", `Bearer ${regular.token}`);

      expect(res.status).toBe(403);
    });

    it("rejects a non-admin trying to ban someone", async () => {
      const res = await request(app)
        .post(`/admin/users/${victim.id}/ban`)
        .set("Authorization", `Bearer ${regular.token}`)
        .send({ reason: REASON });

      expect(res.status).toBe(403);

      const after = await prisma.user.findUniqueOrThrow({
        where: { id: victim.id },
        select: { status: true },
      });
      expect(after.status).toBe("ACTIVE");
    });

    it("lets an admin through", async () => {
      const res = await request(app)
        .get("/admin/users")
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
    });

    it("stops honouring the token as soon as the admin role is revoked", async () => {
      await prisma.user.update({ where: { id: admin.id }, data: { role: "USER" } });

      const res = await request(app)
        .get("/admin/users")
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(403);

      await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } });
    });
  });

  describe("mandatory reason", () => {
    it("refuses a ban with no reason", async () => {
      const res = await request(app)
        .post(`/admin/users/${victim.id}/ban`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({});

      expect(res.status).toBe(400);
    });

    it("refuses a reason too short to explain anything", async () => {
      const res = await request(app)
        .post(`/admin/users/${victim.id}/ban`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ reason: "x" });

      expect(res.status).toBe(400);
    });

    it("refuses a credit adjustment with no reason", async () => {
      const res = await request(app)
        .post(`/admin/users/${victim.id}/credits`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ amount: 50 });

      expect(res.status).toBe(400);
    });

    it("refuses a zero-credit adjustment", async () => {
      const res = await request(app)
        .post(`/admin/users/${victim.id}/credits`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ amount: 0, reason: REASON });

      expect(res.status).toBe(400);
    });
  });

  describe("suspension", () => {
    it("suspends an account and records why", async () => {
      const res = await request(app)
        .post(`/admin/users/${victim.id}/ban`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ reason: REASON });

      expect(res.status).toBe(200);
      expect(res.body.user.status).toBe("SUSPENDED");
      expect(res.body.user.suspensionReason).toBe(REASON);

      const entry = await prisma.adminAuditLog.findFirst({
        where: { action: "USER_BANNED", targetId: victim.id },
        orderBy: { createdAt: "desc" },
      });
      expect(entry?.reason).toBe(REASON);
      expect(entry?.actorId).toBe(admin.id);
    });

    it("locks the suspended user out of the API immediately", async () => {
      const res = await request(app)
        .get("/users/me")
        .set("Authorization", `Bearer ${victim.token}`);

      expect(res.status).toBe(403);
      expect(res.body.reason).toBe(REASON);
    });

    it("refuses to suspend an already suspended account", async () => {
      const res = await request(app)
        .post(`/admin/users/${victim.id}/ban`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ reason: REASON });

      expect(res.status).toBe(400);
    });

    it("refuses to let an admin suspend themselves", async () => {
      const res = await request(app)
        .post(`/admin/users/${admin.id}/ban`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ reason: REASON });

      expect(res.status).toBe(400);
    });

    it("restores access when the suspension is lifted", async () => {
      const res = await request(app)
        .post(`/admin/users/${victim.id}/unban`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ reason: "Appeal upheld after review" });

      expect(res.status).toBe(200);
      expect(res.body.user.status).toBe("ACTIVE");

      const me = await request(app)
        .get("/users/me")
        .set("Authorization", `Bearer ${victim.token}`);
      expect(me.status).toBe(200);
    });
  });

  describe("credit adjustment", () => {
    it("applies a signed delta and records a transaction", async () => {
      const before = await prisma.user.findUniqueOrThrow({
        where: { id: victim.id },
        select: { credits: true },
      });

      const res = await request(app)
        .post(`/admin/users/${victim.id}/credits`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ amount: 25, reason: "Compensation for a lost session" });

      expect(res.status).toBe(200);
      expect(res.body.user.credits).toBe(before.credits + 25);
      expect(res.body.transaction.amount).toBe(25);
      expect(res.body.transaction.adminId).toBe(admin.id);
    });

    it("never pushes a balance past the cap", async () => {
      await prisma.user.update({ where: { id: victim.id }, data: { credits: 495 } });

      const res = await request(app)
        .post(`/admin/users/${victim.id}/credits`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ amount: 100, reason: "Deliberately over the ceiling" });

      expect(res.status).toBe(200);
      expect(res.body.user.credits).toBe(500);
    });

    it("refuses a debit larger than the balance", async () => {
      await prisma.user.update({ where: { id: victim.id }, data: { credits: 10 } });

      const res = await request(app)
        .post(`/admin/users/${victim.id}/credits`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ amount: -400, reason: "Deliberately below zero" });

      expect(res.status).toBe(400);

      const after = await prisma.user.findUniqueOrThrow({
        where: { id: victim.id },
        select: { credits: true },
      });
      expect(after.credits).toBe(10);
    });
  });

  describe("audit trail", () => {
    it("lists entries for an admin", async () => {
      const res = await request(app)
        .get("/admin/audit")
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      expect(res.body.entries.length).toBeGreaterThan(0);
      expect(res.body.entries[0]).toHaveProperty("reason");
    });

    it("exposes no route that writes to the trail", async () => {
      // A trail that can be rewritten proves nothing, so these must not exist.
      for (const method of ["post", "patch", "delete"] as const) {
        const res = await request(app)
          [method]("/admin/audit")
          .set("Authorization", `Bearer ${admin.token}`)
          .send({ action: "FORGED" });

        expect(res.status).toBe(404);
      }
    });
  });

  it("reports platform statistics in the shape the dashboard reads", async () => {
    const res = await request(app)
      .get("/admin/stats")
      .set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);

    // Flat, not nested: the dashboard reads these keys directly, and a nested
    // answer made every tile read undefined and the page render blank.
    for (const key of [
      "totalUsers",
      "activeUsers30d",
      "newUsers7d",
      "sessionsCompleted30d",
      "creditsInCirculation",
      "openReports",
      "pendingOrganizations",
      "openTickets",
      "deltas",
    ]) {
      expect(res.body.stats).toHaveProperty(key);
    }

    expect(res.body.stats.totalUsers).toBeGreaterThan(0);
    expect(res.body.stats.deltas).toHaveProperty("totalUsers");
  });

  it("returns one timeseries point per day, including empty ones", async () => {
    const res = await request(app)
      .get("/admin/stats/traffic?days=5")
      .set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    // A chart that skips quiet days flatters the numbers.
    // The dashboard reads three named keys off this object; handing back a
    // bare array made it call .map on an undefined .timeseries.
    expect(res.body.traffic).toHaveProperty("timeseries");
    expect(res.body.traffic).toHaveProperty("topSkills");
    expect(res.body.traffic).toHaveProperty("usersByStatus");

    expect(res.body.traffic.timeseries).toHaveLength(5);
    expect(res.body.traffic.timeseries[0]).toHaveProperty("visits");
    expect(res.body.traffic.timeseries[0]).toHaveProperty("signups");
    expect(res.body.traffic.timeseries[0]).toHaveProperty("sessions");
  });
});
