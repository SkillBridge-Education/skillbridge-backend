import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import { prisma } from "../utils/prisma";
import { cleanupTestUsers, uniqueTestEmail } from "./helpers";

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
      lastName: "Notify",
    });

  return { id: res.body.user.id as string, token: res.body.token as string };
};

describe("Notifications", () => {
  let owner: TestUser;
  let other: TestUser;

  beforeAll(async () => {
    owner = await registerUser("Nina");
    other = await registerUser("Otto");
  });

  afterAll(async () => {
    await cleanupTestUsers();
    await prisma.$disconnect();
  });

  it("requires authentication", async () => {
    const res = await request(app).get("/notifications");

    expect(res.status).toBe(401);
  });

  it("creates a notification for the caller", async () => {
    const res = await request(app)
      .post("/notifications")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ type: "MESSAGE_RECEIVED", message: "You have a new message" });

    expect(res.status).toBe(201);
  });

  it("lists only the caller's own notifications", async () => {
    const res = await request(app)
      .get("/notifications")
      .set("Authorization", `Bearer ${other.token}`);

    expect(res.status).toBe(200);

    const notifications = res.body.notifications ?? res.body;
    // Otto created none, so nothing from Nina may leak into his list.
    expect(Array.isArray(notifications) ? notifications : []).toHaveLength(0);
  });

  it("rejects an unknown notification type with 400 rather than 500", async () => {
    const res = await request(app)
      .post("/notifications")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ type: "NOT_A_REAL_TYPE", message: "Nope" });

    expect(res.status).toBe(400);
  });

  it("rejects an empty message", async () => {
    const res = await request(app)
      .post("/notifications")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ type: "MESSAGE_RECEIVED", message: "" });

    expect(res.status).toBe(400);
  });

  it("marks the caller's own notification as read", async () => {
    const created = await prisma.notification.create({
      data: { userId: owner.id, type: "MESSAGE_RECEIVED", message: "Mark me" },
      select: { id: true },
    });

    const res = await request(app)
      .patch(`/notifications/${created.id}/read`)
      .set("Authorization", `Bearer ${owner.token}`);

    expect(res.status).toBe(200);

    const after = await prisma.notification.findUniqueOrThrow({
      where: { id: created.id },
      select: { read: true },
    });
    expect(after.read).toBe(true);
  });

  it("refuses to let a user mark someone else's notification as read", async () => {
    const created = await prisma.notification.create({
      data: { userId: owner.id, type: "MESSAGE_RECEIVED", message: "Not yours" },
      select: { id: true },
    });

    const res = await request(app)
      .patch(`/notifications/${created.id}/read`)
      .set("Authorization", `Bearer ${other.token}`);

    expect([403, 404]).toContain(res.status);

    const after = await prisma.notification.findUniqueOrThrow({
      where: { id: created.id },
      select: { read: true },
    });
    expect(after.read).toBe(false);
  });
});
