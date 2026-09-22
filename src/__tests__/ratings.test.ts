import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import { prisma } from "../utils/prisma";
import { cleanupTestUsers, uniqueTestEmail } from "./helpers";

// Ratings feed User.averageRating, which is public, so both the arithmetic and
// the authorization boundaries matter.

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
      lastName: "Rater",
    });

  return { id: res.body.user.id as string, token: res.body.token as string };
};

/** Creates a session and drives it through to COMPLETED so it can be rated. */
const completedSession = async (teacher: TestUser, learner: TestUser): Promise<string> => {
  const created = await request(app)
    .post("/sessions")
    .set("Authorization", `Bearer ${teacher.token}`)
    .send({
      learnerId: learner.id,
      title: "Rated lesson",
      estimatedDuration: 10,
      scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
    });

  const sessionId = created.body.session.id as string;

  await request(app)
    .post(`/sessions/${sessionId}/accept`)
    .set("Authorization", `Bearer ${learner.token}`);
  await request(app)
    .post(`/sessions/${sessionId}/join`)
    .set("Authorization", `Bearer ${teacher.token}`);
  await request(app)
    .post(`/sessions/${sessionId}/end`)
    .set("Authorization", `Bearer ${teacher.token}`)
    .send({ durationSeconds: 600 });

  return sessionId;
};

describe("Session ratings", () => {
  let teacher: TestUser;
  let learner: TestUser;
  let outsider: TestUser;

  beforeAll(async () => {
    teacher = await registerUser("Tess");
    learner = await registerUser("Liam");
    outsider = await registerUser("Oscar");
  });

  afterAll(async () => {
    await cleanupTestUsers();
    await prisma.$disconnect();
  });

  it("lets a participant rate the other one", async () => {
    const sessionId = await completedSession(teacher, learner);

    const res = await request(app)
      .post(`/sessions/${sessionId}/rating`)
      .set("Authorization", `Bearer ${learner.token}`)
      .send({ reviewedUserId: teacher.id, rating: 5, comment: "Very clear" });

    expect(res.status).toBe(201);
  });

  it("updates the reviewed user's public average", async () => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: teacher.id },
      select: { averageRating: true, totalRatings: true },
    });

    expect(user.totalRatings).toBeGreaterThan(0);
    expect(user.averageRating).toBeGreaterThan(0);
  });

  it("rejects a rating outside 1..5", async () => {
    const sessionId = await completedSession(teacher, learner);

    for (const rating of [0, 6, -1]) {
      const res = await request(app)
        .post(`/sessions/${sessionId}/rating`)
        .set("Authorization", `Bearer ${learner.token}`)
        .send({ reviewedUserId: teacher.id, rating });

      expect(res.status).toBe(400);
    }
  });

  it("rejects a non-integer rating", async () => {
    const sessionId = await completedSession(teacher, learner);

    const res = await request(app)
      .post(`/sessions/${sessionId}/rating`)
      .set("Authorization", `Bearer ${learner.token}`)
      .send({ reviewedUserId: teacher.id, rating: 4.5 });

    expect(res.status).toBe(400);
  });

  it("refuses a rating from someone who was not in the session", async () => {
    const sessionId = await completedSession(teacher, learner);

    const res = await request(app)
      .post(`/sessions/${sessionId}/rating`)
      .set("Authorization", `Bearer ${outsider.token}`)
      .send({ reviewedUserId: teacher.id, rating: 1 });

    expect([403, 404]).toContain(res.status);
  });

  it("requires authentication to read a user's ratings", async () => {
    const res = await request(app).get(`/users/${teacher.id}/ratings`);

    expect(res.status).toBe(401);
  });

  it("returns a rating summary for an authenticated caller", async () => {
    const res = await request(app)
      .get(`/users/${teacher.id}/rating-summary`)
      .set("Authorization", `Bearer ${learner.token}`);

    expect(res.status).toBe(200);
  });
});
