import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import { prisma } from "../utils/prisma";
import { AUTO_SUSPEND_THRESHOLD } from "../services/moderationService";
import { cleanupTestUsers, uniqueTestEmail } from "./helpers";

// Auto-suspension is the most abusable feature in the product: get it wrong and
// a few coordinated accounts can silence anyone. These tests pin down that it
// counts *distinct* reporters and that a single account cannot drive it.

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
      lastName: "Moderation",
    });

  return { id: res.body.user.id as string, token: res.body.token as string };
};

const report = (reporter: TestUser, reportedUserId: string) =>
  request(app)
    .post("/reports")
    .set("Authorization", `Bearer ${reporter.token}`)
    .send({
      reportedUserId,
      reason: "HARASSMENT",
      description: "Repeated unwanted messages",
    });

const statusOf = async (userId: string): Promise<string> => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { status: true },
  });
  return user.status;
};

describe("Reporting and auto-suspension", () => {
  let target: TestUser;
  let reporters: TestUser[];

  beforeAll(async () => {
    target = await registerUser("Target");
    reporters = [];
    for (let i = 0; i < AUTO_SUSPEND_THRESHOLD; i += 1) {
      reporters.push(await registerUser(`Reporter${i}`));
    }
  });

  afterAll(async () => {
    await cleanupTestUsers();
    await prisma.$disconnect();
  });

  it("requires authentication", async () => {
    const res = await request(app)
      .post("/reports")
      .send({ reportedUserId: target.id, reason: "SPAM" });

    expect(res.status).toBe(401);
  });

  it("refuses a report against yourself", async () => {
    const res = await report(reporters[0], reporters[0].id);
    expect(res.status).toBe(400);
  });

  it("refuses an unknown reason", async () => {
    const res = await request(app)
      .post("/reports")
      .set("Authorization", `Bearer ${reporters[0].token}`)
      .send({ reportedUserId: target.id, reason: "NOT_A_REASON" });

    expect(res.status).toBe(400);
  });

  it("accepts a first report without suspending anyone", async () => {
    const res = await report(reporters[0], target.id);

    expect(res.status).toBe(201);
    expect(await statusOf(target.id)).toBe("ACTIVE");
  });

  it("refuses a second open report from the same reporter", async () => {
    // Otherwise one account could reach the threshold on its own.
    const res = await report(reporters[0], target.id);
    expect(res.status).toBe(409);
  });

  it("does not suspend below the distinct-reporter threshold", async () => {
    await report(reporters[1], target.id);
    expect(await statusOf(target.id)).toBe("ACTIVE");
  });

  it("suspends once enough distinct people have reported", async () => {
    await report(reporters[2], target.id);

    expect(await statusOf(target.id)).toBe("SUSPENDED");
  });

  it("never auto-suspends an admin", async () => {
    const staff = await registerUser("Staff");
    await prisma.user.update({ where: { id: staff.id }, data: { role: "ADMIN" } });

    // A coordinated campaign must not lock out the people who review the queue.
    for (const reporter of reporters) {
      await report(reporter, staff.id);
    }

    expect(await statusOf(staff.id)).toBe("ACTIVE");
  });
});

describe("Appeals", () => {
  let suspended: TestUser;

  beforeAll(async () => {
    suspended = await registerUser("Appellant");
    await prisma.user.update({
      where: { id: suspended.id },
      data: {
        status: "SUSPENDED",
        suspendedAt: new Date(),
        suspensionReason: "Automatically restricted after multiple reports",
      },
    });
  });

  afterAll(async () => {
    await cleanupTestUsers();
  });

  it("lets a suspended account reach the appeal route", async () => {
    // The whole point: authenticate() rejects them everywhere else.
    const res = await request(app)
      .post("/appeals")
      .set("Authorization", `Bearer ${suspended.token}`)
      .send({ message: "I believe this restriction was applied in error." });

    expect(res.status).toBe(201);
  });

  it("still blocks that account everywhere else", async () => {
    const res = await request(app)
      .get("/users/me")
      .set("Authorization", `Bearer ${suspended.token}`);

    expect(res.status).toBe(403);
  });

  it("refuses a second appeal while one is pending", async () => {
    const res = await request(app)
      .post("/appeals")
      .set("Authorization", `Bearer ${suspended.token}`)
      .send({ message: "Adding another appeal on top of the first one." });

    expect(res.status).toBe(409);
  });

  it("refuses an appeal from an account that is not suspended", async () => {
    const active = await registerUser("Active");

    const res = await request(app)
      .post("/appeals")
      .set("Authorization", `Bearer ${active.token}`)
      .send({ message: "Nothing has happened to my account at all." });

    expect(res.status).toBe(400);
  });
});

describe("School registration requests", () => {
  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { startsWith: "Vitest Lycee" } } });
  });

  it("creates a request without authentication", async () => {
    // A school applies before anyone there has an account.
    const res = await request(app)
      .post("/organizations/requests")
      .send({
        name: "Vitest Lycee Central",
        contactName: "Marie Dupont",
        contactEmail: "marie.dupont@example.org",
      });

    expect(res.status).toBe(201);
  });

  it("never creates a request that is already active", async () => {
    // Self-service approval would defeat the manual review entirely.
    const organization = await prisma.organization.findFirstOrThrow({
      where: { name: "Vitest Lycee Central" },
      select: { status: true },
    });

    expect(organization.status).toBe("PENDING");
  });

  it("refuses a duplicate request", async () => {
    const res = await request(app)
      .post("/organizations/requests")
      .send({
        name: "Vitest Lycee Central",
        contactName: "Someone Else",
        contactEmail: "other@example.org",
      });

    expect(res.status).toBe(409);
  });

  it("refuses an invalid contact email", async () => {
    const res = await request(app)
      .post("/organizations/requests")
      .send({
        name: "Vitest Lycee Nord",
        contactName: "Marie Dupont",
        contactEmail: "not-an-email",
      });

    expect(res.status).toBe(400);
  });
});
