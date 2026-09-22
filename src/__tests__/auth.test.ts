import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import { prisma } from "../utils/prisma";
import { cleanupTestUsers, uniqueTestEmail } from "./helpers";

afterAll(async () => {
  await cleanupTestUsers();
  await prisma.$disconnect();
});

describe("POST /auth/register", () => {
  it("registers a new user and returns a token", async () => {
    const email = uniqueTestEmail();

    const res = await request(app).post("/auth/register").send({
      email,
      password: "correct-horse-battery-staple",
      firstName: "Ada",
      lastName: "Lovelace",
    });

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email, firstName: "Ada" });
    expect(typeof res.body.token).toBe("string");
  });

  it("rejects a duplicate email with 409", async () => {
    const email = uniqueTestEmail();
    const payload = {
      email,
      password: "correct-horse-battery-staple",
      firstName: "Grace",
      lastName: "Hopper",
    };

    const first = await request(app).post("/auth/register").send(payload);
    expect(first.status).toBe(201);

    const second = await request(app).post("/auth/register").send(payload);
    expect(second.status).toBe(409);
    expect(second.body.message).toMatch(/already registered/i);
  });
});

describe("POST /auth/login", () => {
  it("logs in with correct credentials", async () => {
    const email = uniqueTestEmail();
    const password = "correct-horse-battery-staple";

    await request(app).post("/auth/register").send({
      email,
      password,
      firstName: "Katherine",
      lastName: "Johnson",
    });

    const res = await request(app).post("/auth/login").send({ email, password });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(email);
    expect(typeof res.body.token).toBe("string");
  });

  it("rejects an invalid password with 401", async () => {
    const email = uniqueTestEmail();

    await request(app).post("/auth/register").send({
      email,
      password: "correct-horse-battery-staple",
      firstName: "Margaret",
      lastName: "Hamilton",
    });

    const res = await request(app)
      .post("/auth/login")
      .send({ email, password: "wrong-password" });

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/invalid email or password/i);
  });
});
