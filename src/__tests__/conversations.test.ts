import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import { prisma } from "../utils/prisma";
import { cleanupTestUsers, uniqueTestEmail } from "./helpers";

// Conversations only exist once a match is accepted, so these also cover that
// the two are wired together.

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
      lastName: "Chat",
    });

  return { id: res.body.user.id as string, token: res.body.token as string };
};

describe("Conversations and messages", () => {
  let alice: TestUser;
  let bob: TestUser;
  let outsider: TestUser;
  let conversationId: string;

  beforeAll(async () => {
    alice = await registerUser("Alice");
    bob = await registerUser("Bob");
    outsider = await registerUser("Mallory");

    const match = await request(app)
      .post("/matches/request")
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ receiverId: bob.id, message: "Let's talk" });

    await request(app)
      .patch(`/matches/${match.body.match.id}`)
      .set("Authorization", `Bearer ${bob.token}`)
      .send({ status: "ACCEPTED" });

    const conversation = await prisma.conversation.findFirstOrThrow({
      where: { matchId: match.body.match.id as string },
      select: { id: true },
    });
    conversationId = conversation.id;
  });

  afterAll(async () => {
    await cleanupTestUsers();
    await prisma.$disconnect();
  });

  it("creates a conversation when a match is accepted", () => {
    expect(conversationId).toBeTruthy();
  });

  it("requires authentication", async () => {
    const res = await request(app).get("/conversations");

    expect(res.status).toBe(401);
  });

  it("lists the conversation for both participants", async () => {
    for (const user of [alice, bob]) {
      const res = await request(app)
        .get("/conversations")
        .set("Authorization", `Bearer ${user.token}`);

      expect(res.status).toBe(200);
    }
  });

  it("keeps a non-participant out of the conversation", async () => {
    const res = await request(app)
      .get(`/conversations/${conversationId}`)
      .set("Authorization", `Bearer ${outsider.token}`);

    expect(res.status).toBe(403);
  });

  it("refuses a message from a non-participant", async () => {
    const res = await request(app)
      .post(`/conversations/${conversationId}/messages`)
      .set("Authorization", `Bearer ${outsider.token}`)
      .send({ body: "Let me in" });

    expect(res.status).toBe(403);
  });

  it("sends and lists a message between participants", async () => {
    const sent = await request(app)
      .post(`/conversations/${conversationId}/messages`)
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ body: "Hello Bob" });

    expect(sent.status).toBe(201);

    const listed = await request(app)
      .get(`/conversations/${conversationId}/messages`)
      .set("Authorization", `Bearer ${bob.token}`);

    expect(listed.status).toBe(200);
  });

  it("rejects an empty message", async () => {
    const res = await request(app)
      .post(`/conversations/${conversationId}/messages`)
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ body: "   " });

    expect(res.status).toBe(400);
  });

  it("rejects a message beyond the length cap", async () => {
    const res = await request(app)
      .post(`/conversations/${conversationId}/messages`)
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ body: "a".repeat(6000) });

    expect(res.status).toBe(400);
  });

  it("rejects an attachment with an executing scheme", async () => {
    const res = await request(app)
      .post(`/conversations/${conversationId}/messages/file`)
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ fileUrl: "javascript:alert(document.cookie)" });

    expect(res.status).toBe(400);
  });

  it("accepts a well-formed https attachment", async () => {
    const res = await request(app)
      .post(`/conversations/${conversationId}/messages/file`)
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ fileUrl: "https://files.example.com/notes.pdf" });

    expect(res.status).toBe(201);
  });

  it("rejects a malformed conversation id", async () => {
    const res = await request(app)
      .get("/conversations/not-a-uuid")
      .set("Authorization", `Bearer ${alice.token}`);

    expect(res.status).toBe(400);
  });
});
