import { Prisma, UserStatus } from "@prisma/client";
import { HttpError } from "../utils/httpError";
import { prisma } from "../utils/prisma";
import { LearningGoalInput, SkillInput, UpdateProfileInput } from "../utils/profileValidation";
import { toPage, toPrismaPageArgs } from "../utils/pagination";

const skillSelect = { id: true, name: true, description: true, category: true } satisfies Prisma.SkillSelect;

const teachingSkillSelect = {
  id: true, description: true, yearsOfExperience: true, isVerified: true,
  createdAt: true, updatedAt: true, skill: { select: skillSelect }
} satisfies Prisma.UserSkillSelect;

const learningGoalSelect = {
  id: true, description: true, targetLevel: true, isActive: true,
  createdAt: true, updatedAt: true, skill: { select: skillSelect }
} satisfies Prisma.LearningGoalSelect;

const currentUserSelect = {
  id: true, email: true, firstName: true, lastName: true,
  bio: true, avatarUrl: true, bannerUrl: true, availability: true,
  role: true, status: true, credits: true, averageRating: true, totalRatings: true,
  teachingSkills: { select: teachingSkillSelect, orderBy: { createdAt: "desc" } },
  learningGoals:  { where: { isActive: true }, select: learningGoalSelect, orderBy: { createdAt: "desc" } },
  createdAt: true, updatedAt: true
} satisfies Prisma.UserSelect;

const publicUserSelect = {
  id: true, firstName: true, lastName: true, bio: true,
  avatarUrl: true, availability: true, averageRating: true, totalRatings: true,
  teachingSkills: { select: teachingSkillSelect, orderBy: { createdAt: "desc" } },
  learningGoals:  { where: { isActive: true }, select: learningGoalSelect, orderBy: { createdAt: "desc" } },
  createdAt: true
} satisfies Prisma.UserSelect;

const ensureActiveUser = async (userId: string): Promise<void> => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
  if (!user || user.status !== UserStatus.ACTIVE) throw new HttpError(404, "User not found");
};

export const getCurrentUserProfile = async (userId: string) => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: currentUserSelect });
  if (!user || user.status !== UserStatus.ACTIVE) throw new HttpError(404, "User not found");
  return user;
};

export const getPublicUserProfile = async (userId: string) => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: publicUserSelect });
  if (!user) throw new HttpError(404, "User not found");
  return user;
};

export const updateUserProfile = async (userId: string, input: UpdateProfileInput) => {
  await ensureActiveUser(userId);
  const data: Prisma.UserUpdateInput = {};
  if (input.firstName    !== undefined) data.firstName    = input.firstName;
  if (input.lastName     !== undefined) data.lastName     = input.lastName;
  if (input.bio          !== undefined) data.bio          = input.bio;
  if (input.avatarUrl    !== undefined) data.avatarUrl    = input.avatarUrl;
  if (input.bannerUrl    !== undefined) data.bannerUrl    = input.bannerUrl;
  if (input.availability !== undefined) data.availability = input.availability;
  const user = await prisma.user.update({ where: { id: userId }, data, select: currentUserSelect });
  return user;
};

export const addUserSkill = async (userId: string, input: SkillInput) => {
  await ensureActiveUser(userId);
  let skill = input.skillId
    ? await prisma.skill.findUnique({ where: { id: input.skillId } })
    : await prisma.skill.findFirst({ where: { name: { equals: input.name, mode: "insensitive" } } });
  if (!skill) {
    skill = await prisma.skill.create({ data: { name: input.name!, category: input.category ?? null, description: input.description ?? null } });
  }
  const userSkill = await prisma.userSkill.create({
    data: { userId, skillId: skill.id, description: input.description ?? null, yearsOfExperience: input.yearsOfExperience ?? null },
    select: teachingSkillSelect,
  });
  return userSkill;
};

export const removeUserSkill = async (userId: string, userSkillId: string) => {
  const userSkill = await prisma.userSkill.findUnique({ where: { id: userSkillId }, select: { userId: true } });
  if (!userSkill) throw new HttpError(404, "Skill not found");
  if (userSkill.userId !== userId) throw new HttpError(403, "Forbidden");
  await prisma.userSkill.delete({ where: { id: userSkillId } });
};

export const addLearningGoal = async (userId: string, input: LearningGoalInput) => {
  await ensureActiveUser(userId);
  let skill = input.skillId
    ? await prisma.skill.findUnique({ where: { id: input.skillId } })
    : await prisma.skill.findFirst({ where: { name: { equals: input.name, mode: "insensitive" } } });
  if (!skill) {
    skill = await prisma.skill.create({ data: { name: input.name!, category: null, description: input.description ?? null } });
  }
  const goal = await prisma.learningGoal.create({
    data: { userId, skillId: skill.id, description: input.description ?? null, targetLevel: input.targetLevel ?? null },
    select: learningGoalSelect,
  });
  return goal;
};

export const removeLearningGoal = async (userId: string, goalId: string) => {
  const goal = await prisma.learningGoal.findUnique({ where: { id: goalId }, select: { userId: true } });
  if (!goal) throw new HttpError(404, "Learning goal not found");
  if (goal.userId !== userId) throw new HttpError(403, "Forbidden");
  await prisma.learningGoal.delete({ where: { id: goalId } });
};

export const searchUsers = async (params: {
  query?: string;
  skill?: string;
  limit: number;
  cursor?: string;
}) => {
  const where: Prisma.UserWhereInput = { status: UserStatus.ACTIVE };
  if (params.query) {
    where.OR = [
      { firstName: { contains: params.query, mode: "insensitive" } },
      { lastName:  { contains: params.query, mode: "insensitive" } },
    ];
  }
  if (params.skill) {
    where.teachingSkills = { some: { skill: { name: { contains: params.skill, mode: "insensitive" } } } };
  }

  const rows = await prisma.user.findMany({
    where,
    select: publicUserSelect,
    // Ordering by createdAt alone is not stable when two users share a
    // timestamp, which would make a cursor skip or repeat rows.
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...toPrismaPageArgs({ limit: params.limit, cursor: params.cursor }),
  });

  return toPage(rows, params.limit);
};
