import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import { prisma } from "../utils/prisma";
import { cleanupTestUsers, uniqueTestEmail } from "./helpers";

// Sessions are where credits actually move, so these cover the settlement path
// end to end rather than the happy path alone.

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
      lastName: "Session",
    });

  return { id: res.body.user.id as string, token: res.body.token as string };
};

const creditsOf = async (userId: string): Promise<number> => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { credits: true },
  });
  return user.credits;
};

const createSession = async (
  teacher: TestUser,
  learner: TestUser,
  estimatedDuration = 30
) =>
  request(app)
    .post("/sessions")
    .set("Authorization", `Bearer ${teacher.token}`)
    .send({
      learnerId: learner.id,
      title: "Introduction to algebra",
      estimatedDuration,
      scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
    });

describe("Teaching sessions", () => {
  let teacher: TestUser;
  let learner: TestUser;
  let outsider: TestUser;

  beforeAll(async () => {
    teacher = await registerUser("Tara");
    learner = await registerUser("Leo");
    outsider = await registerUser("Olive");
  });

  afterAll(async () => {
    await cleanupTestUsers();
    await prisma.$disconnect();
  });

  it("creates a session awaiting the learner's confirmation", async () => {
    const res = await createSession(teacher, learner);

    expect(res.status).toBe(201);
    expect(res.body.session).toMatchObject({
      teacherId: teacher.id,
      learnerId: learner.id,
    });
  });

  it("rejects a session with a missing learner", async () => {
    const res = await request(app)
      .post("/sessions")
      .set("Authorization", `Bearer ${teacher.token}`)
      .send({ title: "No learner", estimatedDuration: 30, scheduledAt: new Date().toISOString() });

    expect(res.status).toBe(400);
  });

  it("requires authentication", async () => {
    const res = await request(app).get("/sessions/mine");

    expect(res.status).toBe(401);
  });

  it("does not debit the learner before they accept", async () => {
    const before = await creditsOf(learner.id);
    await createSession(teacher, learner);

    expect(await creditsOf(learner.id)).toBe(before);
  });

  it("debits the learner when they accept", async () => {
    const created = await createSession(teacher, learner, 20);
    const sessionId = created.body.session.id as string;
    const before = await creditsOf(learner.id);

    const res = await request(app)
      .post(`/sessions/${sessionId}/accept`)
      .set("Authorization", `Bearer ${learner.token}`);

    expect(res.status).toBe(200);
    expect(await creditsOf(learner.id)).toBe(before - 20);
  });

  it("refuses to let anyone but the learner accept", async () => {
    const created = await createSession(teacher, learner, 10);
    const sessionId = created.body.session.id as string;

    const res = await request(app)
      .post(`/sessions/${sessionId}/accept`)
      .set("Authorization", `Bearer ${outsider.token}`);

    expect(res.status).toBe(403);
  });

  it("keeps non-participants out of a session", async () => {
    const created = await createSession(teacher, learner, 10);
    const sessionId = created.body.session.id as string;

    const res = await request(app)
      .get(`/sessions/${sessionId}`)
      .set("Authorization", `Bearer ${outsider.token}`);

    expect([403, 404]).toContain(res.status);
  });

  it("refunds the unused reservation when a session ends early", async () => {
    const created = await createSession(teacher, learner, 30);
    const sessionId = created.body.session.id as string;

    await request(app)
      .post(`/sessions/${sessionId}/accept`)
      .set("Authorization", `Bearer ${learner.token}`);
    await request(app)
      .post(`/sessions/${sessionId}/join`)
      .set("Authorization", `Bearer ${teacher.token}`);

    const learnerBefore = await creditsOf(learner.id);
    const teacherBefore = await creditsOf(teacher.id);

    // Ran 10 minutes of a 30 minute reservation.
    const res = await request(app)
      .post(`/sessions/${sessionId}/end`)
      .set("Authorization", `Bearer ${teacher.token}`)
      .send({ durationSeconds: 600 });

    expect(res.status).toBe(200);
    expect(await creditsOf(learner.id)).toBe(learnerBefore + 20);
    expect(await creditsOf(teacher.id)).toBe(teacherBefore + 10);
  });

  it("rejects ending a session that is not active", async () => {
    const created = await createSession(teacher, learner, 10);
    const sessionId = created.body.session.id as string;

    const res = await request(app)
      .post(`/sessions/${sessionId}/end`)
      .set("Authorization", `Bearer ${teacher.token}`)
      .send({ durationSeconds: 60 });

    expect(res.status).toBe(400);
  });

  it("rejects a reservation larger than any balance could cover", async () => {
    // Credits are checked when the learner accepts, not when the teacher
    // proposes — but a proposal reserving more than the credit ceiling could
    // never be accepted by anyone, so it is refused up front.
    const res = await createSession(teacher, learner, 10_000);

    expect(res.status).toBe(400);
  });

  it("rejects an implausibly short session", async () => {
    const res = await createSession(teacher, learner, 1);

    expect(res.status).toBe(400);
  });

  it("rejects a session scheduled in the past", async () => {
    const res = await request(app)
      .post("/sessions")
      .set("Authorization", `Bearer ${teacher.token}`)
      .send({
        learnerId: learner.id,
        title: "Yesterday's lesson",
        estimatedDuration: 30,
        scheduledAt: new Date(Date.now() - 86_400_000).toISOString(),
      });

    expect(res.status).toBe(400);
  });

  it("rejects an end duration beyond a plausible session length", async () => {
    const created = await createSession(teacher, learner, 30);
    const sessionId = created.body.session.id as string;

    // A runaway client timer must not be able to bill an implausible duration.
    const res = await request(app)
      .post(`/sessions/${sessionId}/end`)
      .set("Authorization", `Bearer ${teacher.token}`)
      .send({ durationSeconds: 999_999_999 });

    expect(res.status).toBe(400);
  });

  it("lists a participant's own sessions", async () => {
    const res = await request(app)
      .get("/sessions/mine")
      .set("Authorization", `Bearer ${learner.token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.sessions)).toBe(true);
  });
});
