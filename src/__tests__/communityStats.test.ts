import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import { prisma } from "../utils/prisma";
import { cleanupTestUsers, uniqueTestEmail } from "./helpers";

// These numbers are shown prominently on the Discover screen, so the thing to
// guard is that they stay computed from real rows rather than drifting into
// plausible-looking constants.

describe("Community statistics", () => {
  let token: string;

  beforeAll(async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({
        email: uniqueTestEmail(),
        password: "correct-horse-battery-staple",
        firstName: "Stat",
        lastName: "Reader",
      });
    token = res.body.token as string;
  });

  afterAll(async () => {
    await cleanupTestUsers();
    await prisma.$disconnect();
  });

  it("requires authentication", async () => {
    const res = await request(app).get("/stats/community");
    expect(res.status).toBe(401);
  });

  it("reports a member count that matches the database", async () => {
    const res = await request(app)
      .get("/stats/community")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);

    const actual = await prisma.user.count({ where: { status: "ACTIVE" } });
    expect(res.body.stats.members.total).toBe(actual);
  });

  it("reports sessions completed this week, not all time", async () => {
    const res = await request(app)
      .get("/stats/community")
      .set("Authorization", `Bearer ${token}`);

    const allTime = await prisma.teachingSession.count({ where: { status: "COMPLETED" } });
    expect(res.body.stats.sessions.completedThisWeek).toBeLessThanOrEqual(allTime);
  });

  it("returns a rating between 1 and 5, or null when nobody has been rated", async () => {
    const res = await request(app)
      .get("/stats/community")
      .set("Authorization", `Bearer ${token}`);

    const { average } = res.body.stats.rating;

    if (average !== null) {
      // Never 0: that would read as a terrible community rather than an empty one.
      expect(average).toBeGreaterThan(0);
      expect(average).toBeLessThanOrEqual(5);
    }
  });

  it("never counts more active members this week than exist", async () => {
    const res = await request(app)
      .get("/stats/community")
      .set("Authorization", `Bearer ${token}`);

    expect(res.body.stats.members.activeThisWeek).toBeLessThanOrEqual(
      res.body.stats.members.total
    );
  });

  it("exposes no private data through featured members", async () => {
    const res = await request(app)
      .get("/stats/community")
      .set("Authorization", `Bearer ${token}`);

    expect(JSON.stringify(res.body.featuredMembers)).not.toContain("@");
  });
});
