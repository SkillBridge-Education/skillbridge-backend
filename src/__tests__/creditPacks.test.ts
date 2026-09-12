import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import { prisma } from "../utils/prisma";
import { cleanupTestUsers, uniqueTestEmail } from "./helpers";
import { crediterAchat } from "../services/creditPacksService";

/**
 * L'achat de credits, et ce qu'il laisse durablement.
 *
 * Le plafond monte avec l'achat et n'en redescend pas : c'est la partie qui
 * survit a la depense. Sans cela, quelqu'un a 450 credits qui en achete 180 en
 * perdrait 130 -- payes -- et rien ne le lui dirait.
 */

interface TestUser {
  id: string;
  token: string;
}

const registerUser = async (firstName: string): Promise<TestUser> => {
  const res = await request(app).post("/auth/register").send({
    email: uniqueTestEmail(),
    password: "correct-horse-battery-staple",
    firstName,
    lastName: "Achat",
  });
  return { id: res.body.user.id as string, token: res.body.token as string };
};

const soldeEtPlafond = (userId: string) =>
  prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { credits: true, creditCap: true },
  });

describe("Achat de credits", () => {
  let user: TestUser;

  beforeAll(async () => {
    user = await registerUser("Achille");
  });

  afterAll(async () => {
    await cleanupTestUsers();
    await prisma.$disconnect();
  });

  describe("les lots proposes", () => {
    it("exige un compte", async () => {
      const res = await request(app).get("/payments/credit-packs");
      expect(res.status).toBe(401);
    });

    it("annonce ce que chaque lot ferait au plafond", async () => {
      const res = await request(app)
        .get("/payments/credit-packs")
        .set("Authorization", `Bearer ${user.token}`);

      expect(res.status).toBe(200);
      expect(res.body.packs.length).toBeGreaterThan(0);

      // « ton plafond passera de 500 a 700 » est plus parlant que « +180
      // credits », et c'est ce qu'on garde apres avoir depense.
      for (const pack of res.body.packs) {
        expect(pack).toHaveProperty("plafondApres");
        expect(pack).toHaveProperty("gainDePlafond");
      }
    });

    it("ne laisse jamais le client choisir le prix", async () => {
      const res = await request(app)
        .get("/payments/credit-packs")
        .set("Authorization", `Bearer ${user.token}`);

      // Les prix viennent du serveur : un tarif choisi par l'application
      // serait un tarif negociable.
      for (const pack of res.body.packs) {
        expect(Number.isInteger(pack.priceCents)).toBe(true);
        expect(pack.priceCents).toBeGreaterThan(0);
      }
    });
  });

  describe("le versement", () => {
    it("verse les credits et leve le plafond d'autant", async () => {
      const avant = await soldeEtPlafond(user.id);

      const resultat = await crediterAchat({
        userId: user.id,
        packId: "essentiel",
        reference: `test-${Date.now()}`,
        provider: "stripe",
        amountCents: 1199,
      });

      expect(resultat.credited).toBe(180);

      const apres = await soldeEtPlafond(user.id);
      expect(apres.credits).toBe(avant.credits + 180);
      // Le plafond accueille le nouveau solde, arrondi au palier de cent.
      expect(apres.creditCap).toBeGreaterThanOrEqual(apres.credits);
      expect(apres.creditCap % 100).toBe(0);
    });

    it("ne brule rien quand l'achat depasse l'ancien plafond", async () => {
      const cible = await registerUser("Berthe");
      await prisma.user.update({
        where: { id: cible.id },
        data: { credits: 450, creditCap: 500 },
      });

      await crediterAchat({
        userId: cible.id,
        packId: "essentiel",
        reference: `test-depassement-${Date.now()}`,
        provider: "stripe",
        amountCents: 1199,
      });

      const apres = await soldeEtPlafond(cible.id);
      // 450 + 180 = 630. Sans la montee du plafond, 130 credits payes
      // disparaissaient en silence.
      expect(apres.credits).toBe(630);
      expect(apres.creditCap).toBe(700);
    });

    it("ne credite qu'une fois le meme paiement", async () => {
      const cible = await registerUser("Camille");
      const reference = `test-rejoue-${Date.now()}`;

      await crediterAchat({
        userId: cible.id,
        packId: "decouverte",
        reference,
        provider: "stripe",
        amountCents: 499,
      });
      const apresPremier = await soldeEtPlafond(cible.id);

      // Stripe rejoue ses notifications jusqu'a recevoir un accuse : sans
      // garde, un meme paiement crediterait deux ou trois fois.
      const rejeu = await crediterAchat({
        userId: cible.id,
        packId: "decouverte",
        reference,
        provider: "stripe",
        amountCents: 499,
      });

      expect(rejeu.alreadyProcessed).toBe(true);
      expect(rejeu.credited).toBe(0);

      const apresRejeu = await soldeEtPlafond(cible.id);
      expect(apresRejeu.credits).toBe(apresPremier.credits);
    });

    it("laisse une trace lisible dans l'historique", async () => {
      const cible = await registerUser("Denis");
      const reference = `test-trace-${Date.now()}`;

      await crediterAchat({
        userId: cible.id,
        packId: "grand",
        reference,
        provider: "stripe",
        amountCents: 2499,
      });

      // La table d'achats porte la comptabilite : qui, quel lot, combien paye,
      // et ce que l'achat a fait au plafond.
      const achat = await prisma.creditPurchase.findFirst({
        where: { provider: "stripe", reference },
      });
      expect(achat).not.toBeNull();
      expect(achat?.userId).toBe(cible.id);
      expect(achat?.credits).toBe(420);
      expect(achat?.amountCents).toBe(2499);
      expect(achat?.status).toBe("PAID");
      expect(achat?.capAfter).toBeGreaterThanOrEqual(achat!.capBefore);

      // Et l'historique que l'utilisateur lit reste alimente.
      const trace = await prisma.rewardTransaction.findFirst({
        where: { userId: cible.id, amount: 420, type: "EARNED" },
      });
      expect(trace).not.toBeNull();
    });

    it("refuse un lot qui n'existe pas", async () => {
      await expect(
        crediterAchat({
          userId: user.id,
          packId: "lot-imaginaire",
          reference: "x",
          provider: "stripe",
          amountCents: 100,
        })
      ).rejects.toThrow();
    });
  });

  describe("la page de paiement", () => {
    it("refuse d'ouvrir une session pour un lot inconnu", async () => {
      const res = await request(app)
        .post("/payments/credit-packs/lot-imaginaire/checkout")
        .set("Authorization", `Bearer ${user.token}`);

      expect(res.status).toBe(400);
    });

    it("repond clairement quand le paiement n'est pas configure", async () => {
      const res = await request(app)
        .post("/payments/credit-packs/essentiel/checkout")
        .set("Authorization", `Bearer ${user.token}`);

      // Sans STRIPE_SECRET_KEY : 503 et une explication, plutot qu'une erreur
      // interne opaque. L'achat est une fonctionnalite optionnelle.
      expect([200, 503]).toContain(res.status);
      if (res.status === 503) {
        expect(res.body.message).toMatch(/paiement/i);
      }
    });
  });

  describe("la notification de paiement", () => {
    it("refuse une notification sans signature", async () => {
      const res = await request(app)
        .post("/payments/webhook")
        .set("Content-Type", "application/json")
        .send({ type: "checkout.session.completed" });

      // C'est une route publique par construction : sans cette verification,
      // n'importe qui s'attribuerait des credits.
      expect(res.status).toBe(400);
    });

    it("refuse une signature fabriquee", async () => {
      const res = await request(app)
        .post("/payments/webhook")
        .set("Content-Type", "application/json")
        .set("stripe-signature", "t=1,v1=faux")
        .send({ type: "checkout.session.completed" });

      expect([400, 503]).toContain(res.status);
    });
  });
});
