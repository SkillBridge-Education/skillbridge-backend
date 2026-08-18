import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import { prisma } from "../utils/prisma";
import { cleanupTestUsers, uniqueTestEmail } from "./helpers";

// The point of the two-axis model is that a TEACHER is privileged inside their
// own school and nowhere else. These tests exist to make that boundary hard to
// break: the school id always comes from the caller's membership, never from
// the request.

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
      lastName: "School",
    });

  return { id: res.body.user.id as string, token: res.body.token as string };
};

const ORG_A = "Vitest School Alpha";
const ORG_B = "Vitest School Beta";

describe("School membership and teacher dashboard", () => {
  let orgA: string;
  let orgB: string;
  let teacherA: TestUser;
  let adminA: TestUser;
  let studentA: TestUser;
  let teacherB: TestUser;
  let outsider: TestUser;

  beforeAll(async () => {
    teacherA = await registerUser("Tania");
    adminA = await registerUser("Alain");
    studentA = await registerUser("Sofia");
    teacherB = await registerUser("Bruno");
    outsider = await registerUser("Olga");

    const a = await prisma.organization.create({
      data: {
        name: ORG_A,
        slug: `vitest-alpha-${Date.now()}`,
        status: "ACTIVE",
        contactName: "Contact A",
        contactEmail: "a@example.org",
      },
    });
    const b = await prisma.organization.create({
      data: {
        name: ORG_B,
        slug: `vitest-beta-${Date.now()}`,
        status: "ACTIVE",
        contactName: "Contact B",
        contactEmail: "b@example.org",
      },
    });
    orgA = a.id;
    orgB = b.id;

    await prisma.membership.createMany({
      data: [
        { userId: teacherA.id, organizationId: orgA, orgRole: "TEACHER" },
        { userId: adminA.id, organizationId: orgA, orgRole: "ORG_ADMIN" },
        { userId: studentA.id, organizationId: orgA, orgRole: "STUDENT" },
        { userId: teacherB.id, organizationId: orgB, orgRole: "TEACHER" },
      ],
    });
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { startsWith: "Vitest School" } } });
    await cleanupTestUsers();
    await prisma.$disconnect();
  });

  describe("mode detection", () => {
    it("reports INDIVIDUAL for an account with no membership", async () => {
      const res = await request(app)
        .get("/school/me/membership")
        .set("Authorization", `Bearer ${outsider.token}`);

      expect(res.status).toBe(200);
      expect(res.body.mode).toBe("INDIVIDUAL");
      expect(res.body.membership).toBeNull();
    });

    it("reports SCHOOL for a member", async () => {
      const res = await request(app)
        .get("/school/me/membership")
        .set("Authorization", `Bearer ${studentA.token}`);

      expect(res.body.mode).toBe("SCHOOL");
      expect(res.body.membership.orgRole).toBe("STUDENT");
    });
  });

  describe("teacher dashboard access", () => {
    it("refuses an account with no school", async () => {
      const res = await request(app)
        .get("/school/teacher/students")
        .set("Authorization", `Bearer ${outsider.token}`);

      expect(res.status).toBe(403);
    });

    it("refuses a student of the school", async () => {
      // Being in a school is not enough; the orgRole has to allow it.
      const res = await request(app)
        .get("/school/teacher/students")
        .set("Authorization", `Bearer ${studentA.token}`);

      expect(res.status).toBe(403);
    });

    it("allows a teacher", async () => {
      const res = await request(app)
        .get("/school/teacher/students")
        .set("Authorization", `Bearer ${teacherA.token}`);

      expect(res.status).toBe(200);
    });
  });

  describe("school isolation", () => {
    it("shows a teacher only their own school's students", async () => {
      const res = await request(app)
        .get("/school/teacher/students")
        .set("Authorization", `Bearer ${teacherA.token}`);

      const ids = res.body.students.map((row: { student: { id: string } }) => row.student.id);
      expect(ids).toContain(studentA.id);
      expect(ids).not.toContain(teacherB.id);
    });

    it("shows a teacher from another school none of these students", async () => {
      const res = await request(app)
        .get("/school/teacher/students")
        .set("Authorization", `Bearer ${teacherB.token}`);

      const ids = res.body.students.map((row: { student: { id: string } }) => row.student.id);
      expect(ids).not.toContain(studentA.id);
    });

    it("refuses to verify a skill belonging to another school's student", async () => {
      const skill = await prisma.skill.create({
        data: { name: `Vitest Skill ${Date.now()}` },
      });
      const userSkill = await prisma.userSkill.create({
        data: { userId: studentA.id, skillId: skill.id },
      });

      const res = await request(app)
        .patch(`/school/teacher/skills/${userSkill.id}/verify`)
        .set("Authorization", `Bearer ${teacherB.token}`)
        .send({ verified: true });

      expect(res.status).toBe(403);

      const after = await prisma.userSkill.findUniqueOrThrow({
        where: { id: userSkill.id },
        select: { isVerified: true },
      });
      expect(after.isVerified).toBe(false);

      await prisma.userSkill.delete({ where: { id: userSkill.id } });
      await prisma.skill.delete({ where: { id: skill.id } });
    });

    it("lets a teacher verify their own school's student", async () => {
      const skill = await prisma.skill.create({
        data: { name: `Vitest Skill B ${Date.now()}` },
      });
      const userSkill = await prisma.userSkill.create({
        data: { userId: studentA.id, skillId: skill.id },
      });

      const res = await request(app)
        .patch(`/school/teacher/skills/${userSkill.id}/verify`)
        .set("Authorization", `Bearer ${teacherA.token}`)
        .send({ verified: true });

      expect(res.status).toBe(200);
      expect(res.body.skill.isVerified).toBe(true);

      await prisma.userSkill.delete({ where: { id: userSkill.id } });
      await prisma.skill.delete({ where: { id: skill.id } });
    });
  });

  describe("membership management", () => {
    it("refuses a teacher who is not a school admin", async () => {
      const res = await request(app)
        .post("/school/members")
        .set("Authorization", `Bearer ${teacherA.token}`)
        .send({ userId: outsider.id, orgRole: "STUDENT" });

      expect(res.status).toBe(403);
    });

    it("lets a school admin enrol a member into their own school", async () => {
      const res = await request(app)
        .post("/school/members")
        .set("Authorization", `Bearer ${adminA.token}`)
        .send({ userId: outsider.id, orgRole: "STUDENT" });

      expect(res.status).toBe(201);
      expect(res.body.membership.organizationId).toBe(orgA);
    });

    it("refuses to enrol someone who already belongs to another school", async () => {
      const res = await request(app)
        .post("/school/members")
        .set("Authorization", `Bearer ${adminA.token}`)
        .send({ userId: teacherB.id, orgRole: "STUDENT" });

      expect(res.status).toBe(409);
    });

    it("refuses a school admin removing themselves", async () => {
      const res = await request(app)
        .delete(`/school/members/${adminA.id}`)
        .set("Authorization", `Bearer ${adminA.token}`);

      expect(res.status).toBe(400);
    });
  });

  it("refuses members of a school that is not approved", async () => {
    // Suspending a school must remove its staff powers.
    await prisma.organization.update({ where: { id: orgA }, data: { status: "SUSPENDED" } });

    const res = await request(app)
      .get("/school/teacher/students")
      .set("Authorization", `Bearer ${teacherA.token}`);

    expect(res.status).toBe(403);

    await prisma.organization.update({ where: { id: orgA }, data: { status: "ACTIVE" } });
  });
});
