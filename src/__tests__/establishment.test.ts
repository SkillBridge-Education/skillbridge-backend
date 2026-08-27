import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import { prisma } from "../utils/prisma";
import { cleanupTestUsers, uniqueTestEmail } from "./helpers";

/**
 * "Mon etablissement", walked end to end: a representative registers a school,
 * a platform admin approves it, the school issues a seat, and a pupil uses it.
 *
 * Written as one journey rather than as isolated unit tests because every defect
 * this flow can have lives *between* the steps — an approval that activates a
 * school but seats nobody, a code that is accepted from the wrong address, a
 * revocation that stops future sign-ups but leaves the member inside.
 */

interface TestUser {
  id: string;
  token: string;
  email: string;
}

const registerUser = async (
  firstName: string,
  extra: Record<string, unknown> = {}
): Promise<TestUser & { body: Record<string, unknown> }> => {
  const email = uniqueTestEmail();
  const res = await request(app)
    .post("/auth/register")
    .send({
      email,
      password: "correct-horse-battery-staple",
      firstName,
      lastName: "Ecole",
      ...extra,
    });

  return {
    id: res.body.user?.id as string,
    token: res.body.token as string,
    email,
    body: res.body,
  };
};

const APPLICATION = {
  name: "Lycee Vitest International",
  shortName: "LVI",
  shortDescription: "Un etablissement de test",
  officialEmail: "contact@lycee-vitest.fr",
  website: "https://lycee-vitest.fr",
  country: "France",
  city: "Paris",
  postalCode: "75011",
  category: "LYCEE",
  type: "PUBLIC",
  teachingMode: "HYBRID",
  languages: ["Francais", "Anglais"],
  representativeFunction: "Directeur adjoint",
  campuses: [
    { name: "Campus Paris", city: "Paris" },
    { name: "Campus en ligne", isOnline: true },
  ],
};

describe("Mon etablissement", () => {
  let representative: TestUser;
  let platformAdmin: TestUser;
  let organizationId: string;
  let publicId: string;

  beforeAll(async () => {
    representative = await registerUser("Rachida");
    platformAdmin = await registerUser("Pascal");
    await prisma.user.update({
      where: { id: platformAdmin.id },
      data: { role: "ADMIN" },
    });
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { name: APPLICATION.name } });
    await cleanupTestUsers();
    await prisma.$disconnect();
  });

  describe("applying", () => {
    it("refuses an application from someone not signed in", async () => {
      const res = await request(app).post("/school/apply").send(APPLICATION);
      expect(res.status).toBe(401);
    });

    it("records the application, its campuses and who applied", async () => {
      const res = await request(app)
        .post("/school/apply")
        .set("Authorization", `Bearer ${representative.token}`)
        .send(APPLICATION);

      expect(res.status).toBe(201);
      expect(res.body.organization.status).toBe("PENDING");
      expect(res.body.organization.campuses).toHaveLength(2);

      organizationId = res.body.organization.id;

      const stored = await prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: {
          requestedById: true,
          representativeFunction: true,
          category: true,
          officialEmail: true,
          publicId: true,
        },
      });

      expect(stored.requestedById).toBe(representative.id);
      expect(stored.representativeFunction).toBe("Directeur adjoint");
      expect(stored.category).toBe("LYCEE");
      // Issuing the identifier is what approval *means*, so a pending row
      // must not carry one.
      expect(stored.publicId).toBeNull();
    });

    it("refuses a second live application from the same representative", async () => {
      const res = await request(app)
        .post("/school/apply")
        .set("Authorization", `Bearer ${representative.token}`)
        .send({ ...APPLICATION, name: "Autre Lycee Vitest" });

      expect(res.status).toBe(409);
    });

    it("refuses a website that is not https", async () => {
      const other = await registerUser("Wanda");
      const res = await request(app)
        .post("/school/apply")
        .set("Authorization", `Bearer ${other.token}`)
        .send({
          ...APPLICATION,
          name: "Ecole Javascript Vitest",
          website: "javascript:alert(1)",
        });

      expect(res.status).toBe(400);
    });

    it("shows the representative their pending application", async () => {
      const res = await request(app)
        .get("/school/my-application")
        .set("Authorization", `Bearer ${representative.token}`);

      expect(res.status).toBe(200);
      expect(res.body.application.status).toBe("PENDING");
      expect(res.body.application.publicId).toBeNull();
    });
  });

  describe("approval", () => {
    it("cannot issue access codes before the school is approved", async () => {
      const res = await request(app)
        .post("/school/access-codes")
        .set("Authorization", `Bearer ${representative.token}`)
        .send({ role: "STUDENT", email: "eleve@lycee-vitest.fr" });

      expect(res.status).toBe(403);
    });

    it("issues an identifier and seats the applicant as super admin", async () => {
      const res = await request(app)
        .post(`/admin/organizations/${organizationId}/approve`)
        .set("Authorization", `Bearer ${platformAdmin.token}`)
        .send({ reason: "Etablissement verifie par telephone" });

      expect(res.status).toBe(200);

      const organization = await prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { status: true, publicId: true },
      });

      expect(organization.status).toBe("ACTIVE");
      expect(organization.publicId).toMatch(/^SB-[A-Z]+-[A-Z0-9]{5}$/);
      publicId = organization.publicId as string;

      // An active school with nobody able to administer it is a dead end for
      // the person who applied.
      const membership = await prisma.membership.findUniqueOrThrow({
        where: {
          userId_organizationId: { userId: representative.id, organizationId },
        },
        select: { orgRole: true, status: true },
      });
      expect(membership.orgRole).toBe("ORG_SUPER_ADMIN");
      expect(membership.status).toBe("ACTIVE");
    });
  });

  describe("access codes", () => {
    let studentCode: string;

    it("issues a code bound to one address", async () => {
      const res = await request(app)
        .post("/school/access-codes")
        .set("Authorization", `Bearer ${representative.token}`)
        .send({
          role: "STUDENT",
          email: "Eleve.Vitest@lycee-vitest.fr",
          firstName: "Elodie",
        });

      expect(res.status).toBe(201);
      expect(res.body.code.code).toMatch(/^STU-[A-Z0-9]{6}$/);
      // Lower-cased at write time: the uniqueness constraint depends on it.
      expect(res.body.code.email).toBe("eleve.vitest@lycee-vitest.fr");
      studentCode = res.body.code.code;
    });

    it("refuses a second live code for the same person and role", async () => {
      const res = await request(app)
        .post("/school/access-codes")
        .set("Authorization", `Bearer ${representative.token}`)
        .send({ role: "STUDENT", email: "eleve.vitest@lycee-vitest.fr" });

      expect(res.status).toBe(409);
    });

    it("refuses the code when presented with a different address", async () => {
      // The code travels by email and can be forwarded. What proves
      // authorisation is the pair, never the code alone.
      const res = await request(app)
        .post("/school/access-codes/verify")
        .send({ code: studentCode, email: "quelquun.dautre@example.com" });

      expect(res.status).toBe(400);
      // The refusal must not reveal which address the code belongs to.
      expect(JSON.stringify(res.body)).not.toContain("eleve.vitest");
    });

    it("confirms the school for the address it was issued to", async () => {
      const res = await request(app)
        .post("/school/access-codes/verify")
        .send({ code: studentCode, email: "eleve.vitest@lycee-vitest.fr" });

      expect(res.status).toBe(200);
      expect(res.body.role).toBe("STUDENT");
      expect(res.body.organization.name).toBe(APPLICATION.name);
    });

    it("refuses an unknown code the same way as a wrong address", async () => {
      const res = await request(app)
        .post("/school/access-codes/verify")
        .send({ code: "STU-ZZZZZZ", email: "eleve.vitest@lycee-vitest.fr" });

      expect(res.status).toBe(400);
    });
  });

  describe("signing up with a code", () => {
    let pupilCode: string;
    let pupilEmail: string;

    beforeAll(async () => {
      pupilEmail = uniqueTestEmail();
      const res = await request(app)
        .post("/school/access-codes")
        .set("Authorization", `Bearer ${representative.token}`)
        .send({ role: "STUDENT", email: pupilEmail, firstName: "Pia" });
      pupilCode = res.body.code.code;
    });

    it("creates no account at all when the code does not match", async () => {
      const strangerEmail = uniqueTestEmail();
      const res = await request(app).post("/auth/register").send({
        email: strangerEmail,
        password: "correct-horse-battery-staple",
        firstName: "Sam",
        lastName: "Ecole",
        accessCode: pupilCode,
      });

      expect(res.status).toBe(400);

      // The whole reason the code is checked first: a mistyped identifier must
      // not leave somebody holding a personal account they never asked for.
      const created = await prisma.user.findUnique({
        where: { email: strangerEmail },
        select: { id: true },
      });
      expect(created).toBeNull();
    });

    it("attaches the pupil to the school with the role the code carries", async () => {
      const res = await request(app).post("/auth/register").send({
        email: pupilEmail,
        password: "correct-horse-battery-staple",
        firstName: "Pia",
        lastName: "Ecole",
        accessCode: pupilCode,
      });

      expect(res.status).toBe(201);
      expect(res.body.membership.orgRole).toBe("STUDENT");
      expect(res.body.organization.name).toBe(APPLICATION.name);

      const code = await prisma.accessCode.findUniqueOrThrow({
        where: { code: pupilCode },
        select: { status: true, activatedAt: true },
      });
      // Marked, not consumed: the same code is what they sign in with.
      expect(code.status).toBe("ACTIVATED");
      expect(code.activatedAt).not.toBeNull();
    });

    it("signs in on the school tab with the personal code", async () => {
      const res = await request(app).post("/auth/login").send({
        email: pupilEmail,
        password: "correct-horse-battery-staple",
        establishmentId: pupilCode,
      });

      expect(res.status).toBe(200);
      expect(res.body.organization.name).toBe(APPLICATION.name);
      expect(res.body.membership.orgRole).toBe("STUDENT");
    });

    it("signs the representative in with the school identifier", async () => {
      const res = await request(app).post("/auth/login").send({
        email: representative.email,
        password: "correct-horse-battery-staple",
        establishmentId: publicId,
      });

      expect(res.status).toBe(200);
      expect(res.body.membership.orgRole).toBe("ORG_SUPER_ADMIN");
    });

    it("refuses a school sign-in from an account that is not a member", async () => {
      const outsider = await registerUser("Olivier");
      const res = await request(app).post("/auth/login").send({
        email: outsider.email,
        password: "correct-horse-battery-staple",
        establishmentId: publicId,
      });

      expect(res.status).toBe(403);
    });

    it("closes the member's seat when their code is revoked", async () => {
      const stored = await prisma.accessCode.findUniqueOrThrow({
        where: { code: pupilCode },
        select: { id: true, activatedById: true },
      });

      const res = await request(app)
        .delete(`/school/access-codes/${stored.id}`)
        .set("Authorization", `Bearer ${representative.token}`);

      expect(res.status).toBe(200);

      // Revoking only future sign-ups would leave the member inside.
      const membership = await prisma.membership.findFirstOrThrow({
        where: { userId: stored.activatedById as string, organizationId },
        select: { status: true },
      });
      expect(membership.status).toBe("REVOKED");

      const signIn = await request(app).post("/auth/login").send({
        email: pupilEmail,
        password: "correct-horse-battery-staple",
        establishmentId: pupilCode,
      });
      expect(signIn.status).toBe(403);
    });
  });

  describe("bulk issue", () => {
    it("reports per-row outcomes instead of failing the batch", async () => {
      const shared = uniqueTestEmail();
      const res = await request(app)
        .post("/school/access-codes/bulk")
        .set("Authorization", `Bearer ${representative.token}`)
        .send({
          rows: [
            { role: "STUDENT", email: uniqueTestEmail(), firstName: "A" },
            { role: "STUDENT", email: shared, firstName: "B" },
            // Same address twice in one import: the realistic failure.
            { role: "STUDENT", email: shared, firstName: "B again" },
            { role: "TEACHER", email: uniqueTestEmail(), firstName: "C" },
          ],
        });

      // 207: a partial success is the normal outcome for a real school export.
      expect(res.status).toBe(207);
      expect(res.body.issued).toHaveLength(3);
      expect(res.body.failed).toHaveLength(1);
      expect(res.body.total).toBe(4);
    });
  });
});
