import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";

describe("GET /", () => {
  it("returns 200 with a healthy status", async () => {
    const res = await request(app).get("/");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok" });
  });
});
