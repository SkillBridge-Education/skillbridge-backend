import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import { prisma } from "../utils/prisma";
import { MAX_PAGE_SIZE } from "../utils/pagination";
import { cleanupTestUsers } from "./helpers";

// /users/search is public and unauthenticated, so its query string is the most
// exposed untrusted input in the API.

describe("Search query validation", () => {
  afterAll(async () => {
    await cleanupTestUsers();
    await prisma.$disconnect();
  });

  it("applies a default page size when none is given", async () => {
    const res = await request(app).get("/users/search");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.users)).toBe(true);
    expect(res.body.users.length).toBeLessThanOrEqual(MAX_PAGE_SIZE);
    expect(res.body).toHaveProperty("hasMore");
    expect(res.body).toHaveProperty("nextCursor");
  });

  it("rejects a limit above the server maximum instead of honouring it", async () => {
    const res = await request(app).get("/users/search?limit=5000");

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Validation failed");
  });

  it("rejects a non-numeric limit", async () => {
    const res = await request(app).get("/users/search?limit=abc");

    expect(res.status).toBe(400);
  });

  it("rejects a negative limit", async () => {
    const res = await request(app).get("/users/search?limit=-1");

    expect(res.status).toBe(400);
  });

  it("rejects a cursor that is not a uuid", async () => {
    const res = await request(app).get("/users/search?cursor=not-a-uuid");

    expect(res.status).toBe(400);
  });

  it("rejects an oversized search term", async () => {
    const res = await request(app).get(`/users/search?q=${"a".repeat(500)}`);

    expect(res.status).toBe(400);
  });

  it("returns a descriptive error payload", async () => {
    const res = await request(app).get("/users/search?limit=0");

    expect(res.body).toMatchObject({ message: "Validation failed" });
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(res.body.errors[0]).toHaveProperty("path");
    expect(res.body.errors[0]).toHaveProperty("message");
  });

  it("rejects a malformed user id on the public profile route", async () => {
    const res = await request(app).get("/users/not-a-uuid");

    expect(res.status).toBe(400);
  });

  it("exposes the health check on /health for monitoring", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});
