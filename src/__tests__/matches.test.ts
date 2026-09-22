import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import { prisma } from "../utils/prisma";
import { cleanupTestUsers, uniqueTestEmail } from "./helpers";

interface RegisteredUser {
  id: string;
  token: string;
}

const registerUser = async (firstName: string, lastName: string): Promise<RegisteredUser> => {
  const res = await request(app)
    .post("/auth/register")
    .send({
      email: uniqueTestEmail(),
      password: "correct-horse-battery-staple",
      firstName,
      lastName,
    });

  return { id: res.body.user.id as string, token: res.body.token as string };
};

describe("Match request → accept flow", () => {
  let requester: RegisteredUser;
  let receiver: RegisteredUser;

  beforeAll(async () => {
    requester = await registerUser("Alice", "Requester");
    receiver = await registerUser("Bob", "Receiver");
  });

  afterAll(async () => {
    await cleanupTestUsers();
    await prisma.$disconnect();
  });

  it("creates a pending match request", async () => {
    const res = await request(app)
      .post("/matches/request")
      .set("Authorization", `Bearer ${requester.token}`)
      .send({ receiverId: receiver.id, message: "Hello!" });

    expect(res.status).toBe(201);
    expect(res.body.match).toMatchObject({
      requesterId: requester.id,
      receiverId: receiver.id,
      status: "PENDING",
    });
  });

  it("lists the pending match for both participants", async () => {
    const res = await request(app)
      .get("/matches/mine")
      .set("Authorization", `Bearer ${receiver.token}`);

    expect(res.status).toBe(200);
    expect(res.body.matches).toHaveLength(1);
    expect(res.body.matches[0].status).toBe("PENDING");
  });

  it("lets the receiver accept the match and opens a conversation", async () => {
    const mine = await request(app)
      .get("/matches/mine")
      .set("Authorization", `Bearer ${receiver.token}`);
    const matchId = mine.body.matches[0].id as string;

    const res = await request(app)
      .patch(`/matches/${matchId}`)
      .set("Authorization", `Bearer ${receiver.token}`)
      .send({ status: "ACCEPTED" });

    expect(res.status).toBe(200);
    expect(res.body.match.status).toBe("ACCEPTED");
    expect(res.body.match.conversation).not.toBeNull();
  });

  it("rejects a second accept attempt since the match is no longer pending", async () => {
    const mine = await request(app)
      .get("/matches/mine")
      .set("Authorization", `Bearer ${receiver.token}`);
    const matchId = mine.body.matches[0].id as string;

    const res = await request(app)
      .patch(`/matches/${matchId}`)
      .set("Authorization", `Bearer ${receiver.token}`)
      .send({ status: "ACCEPTED" });

    expect(res.status).toBe(409);
  });
});
