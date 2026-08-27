import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import { prisma } from "../utils/prisma";
import { cleanupTestUsers, uniqueTestEmail } from "./helpers";

/**
 * The long-press menu in the chat: reply, edit, pin, withdraw.
 *
 * These exist because the service behind them was written and tested and then
 * never mounted on a router, so the menu offered four actions that all answered
 * 404 on a real device. A unit test of the service could not have caught that —
 * only a request through the actual route can.
 */

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

const conversationBetween = async (a: string, b: string): Promise<string> => {
  const conversation = await prisma.conversation.create({
    data: { firstUserId: a, secondUserId: b },
  });
  return conversation.id;
};

describe("Message actions", () => {
  let alice: TestUser;
  let bob: TestUser;
  let mallory: TestUser;
  let conversationId: string;
  let otherConversationId: string;

  beforeAll(async () => {
    alice = await registerUser("Alice");
    bob = await registerUser("Bob");
    mallory = await registerUser("Mallory");
    conversationId = await conversationBetween(alice.id, bob.id);
    otherConversationId = await conversationBetween(bob.id, mallory.id);
  });

  afterAll(async () => {
    await cleanupTestUsers();
    await prisma.$disconnect();
  });

  const send = (user: TestUser, body: string, replyToId?: string) =>
    request(app)
      .post(`/conversations/${conversationId}/messages`)
      .set("Authorization", `Bearer ${user.token}`)
      .send(replyToId ? { body, replyToId } : { body });

  describe("replying", () => {
    it("stores the quoted message and returns it with the reply", async () => {
      const original = await send(alice, "Quelle est la salle ?");
      expect(original.status).toBe(201);

      const reply = await send(bob, "Salle B12", original.body.id);

      expect(reply.status).toBe(201);
      // The whole point: without this the bubble shows a quote optimistically
      // and then loses it, because the field was silently stripped.
      expect(reply.body.replyToId).toBe(original.body.id);
      expect(reply.body.replyTo.body).toBe("Quelle est la salle ?");
      expect(reply.body.replyTo.sender.id).toBe(alice.id);
    });

    it("still carries the quote when the thread is reloaded", async () => {
      const original = await send(alice, "On commence a quelle heure ?");
      await send(bob, "14h", original.body.id);

      const history = await request(app)
        .get(`/conversations/${conversationId}/messages`)
        .set("Authorization", `Bearer ${bob.token}`);

      const reloaded = history.body.messages.find(
        (message: { replyToId?: string }) => message.replyToId === original.body.id
      );
      expect(reloaded).toBeDefined();
      expect(reloaded.replyTo.body).toBe("On commence a quelle heure ?");
    });

    it("refuses to quote a message from a conversation the sender is not in", async () => {
      // The quote carries the original text back to the client, so accepting any
      // id would turn the reply field into a way to read other people messages.
      const foreign = await request(app)
        .post(`/conversations/${otherConversationId}/messages`)
        .set("Authorization", `Bearer ${mallory.token}`)
        .send({ body: "Secret entre Bob et Mallory" });

      const res = await send(alice, "Ah bon ?", foreign.body.id);

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toContain("Secret entre Bob et Mallory");
    });

    it("rejects a quote of a message that does not exist", async () => {
      const res = await send(alice, "Reponse", "00000000-0000-4000-8000-000000000000");
      expect(res.status).toBe(400);
    });
  });

  describe("editing", () => {
    it("lets the author correct their own message", async () => {
      const sent = await send(alice, "Rendez-vous a 15h");

      const res = await request(app)
        .patch(`/conversations/${conversationId}/messages/${sent.body.id}`)
        .set("Authorization", `Bearer ${alice.token}`)
        .send({ body: "Rendez-vous a 16h" });

      expect(res.status).toBe(200);
      expect(res.body.message.body).toBe("Rendez-vous a 16h");
      expect(res.body.message.editedAt).not.toBeNull();
    });

    it("refuses to let the other participant rewrite someone words", async () => {
      const sent = await send(alice, "Je confirme");

      const res = await request(app)
        .patch(`/conversations/${conversationId}/messages/${sent.body.id}`)
        .set("Authorization", `Bearer ${bob.token}`)
        .send({ body: "Je ne confirme pas" });

      expect(res.status).toBe(403);

      const after = await prisma.message.findUniqueOrThrow({ where: { id: sent.body.id } });
      expect(after.body).toBe("Je confirme");
    });
  });

  describe("withdrawing", () => {
    it("hides a message for the caller alone", async () => {
      const sent = await send(alice, "Message a masquer");

      const res = await request(app)
        .delete(`/conversations/${conversationId}/messages/${sent.body.id}?scope=me`)
        .set("Authorization", `Bearer ${alice.token}`);

      expect(res.status).toBe(200);

      // Still there for Bob: "delete for me" is not a deletion.
      const forBob = await prisma.message.findUniqueOrThrow({ where: { id: sent.body.id } });
      expect(forBob.deletedForEveryone).toBe(false);
    });

    it("withdraws a message for both sides, leaving a tombstone", async () => {
      const sent = await send(alice, "Message a retirer");

      const res = await request(app)
        .delete(`/conversations/${conversationId}/messages/${sent.body.id}?scope=everyone`)
        .set("Authorization", `Bearer ${alice.token}`);

      expect(res.status).toBe(200);

      const after = await prisma.message.findUniqueOrThrow({ where: { id: sent.body.id } });
      expect(after.deletedForEveryone).toBe(true);
      // The row survives so replies pointing at it stay coherent.
      expect(after.id).toBe(sent.body.id);
    });

    it("refuses to answer a message that was withdrawn", async () => {
      const sent = await send(alice, "Sera retire");
      await request(app)
        .delete(`/conversations/${conversationId}/messages/${sent.body.id}?scope=everyone`)
        .set("Authorization", `Bearer ${alice.token}`);

      const res = await send(bob, "Trop tard", sent.body.id);
      expect(res.status).toBe(400);
    });
  });

  describe("pinning", () => {
    it("pins and unpins, and lists what is pinned", async () => {
      const sent = await send(alice, "Le lien du cours");

      const pin = await request(app)
        .post(`/conversations/${conversationId}/messages/${sent.body.id}/pin`)
        .set("Authorization", `Bearer ${bob.token}`);
      expect(pin.status).toBe(200);
      expect(pin.body.message.pinnedAt).not.toBeNull();

      const pinned = await request(app)
        .get(`/conversations/${conversationId}/messages/pinned`)
        .set("Authorization", `Bearer ${alice.token}`);
      expect(pinned.status).toBe(200);
      expect(pinned.body.messages.some((m: { id: string }) => m.id === sent.body.id)).toBe(true);

      const unpin = await request(app)
        .delete(`/conversations/${conversationId}/messages/${sent.body.id}/pin`)
        .set("Authorization", `Bearer ${bob.token}`);
      expect(unpin.status).toBe(200);
      expect(unpin.body.message.pinnedAt).toBeNull();
    });

    it("refuses every action from someone outside the conversation", async () => {
      const sent = await send(alice, "Prive");
      const base = `/conversations/${conversationId}/messages/${sent.body.id}`;

      for (const call of [
        request(app).patch(base).send({ body: "Intrusion" }),
        request(app).delete(base),
        request(app).post(`${base}/pin`),
      ]) {
        const res = await call.set("Authorization", `Bearer ${mallory.token}`);
        expect(res.status).toBe(403);
      }
    });
  });
});
