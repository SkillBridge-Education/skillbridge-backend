"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchUsers = exports.removeLearningGoal = exports.addLearningGoal = exports.removeUserSkill = exports.addUserSkill = exports.updateUserProfile = exports.getPublicUserProfile = exports.getCurrentUserProfile = void 0;
const client_1 = require("@prisma/client");
const httpError_1 = require("../utils/httpError");
const prisma_1 = require("../utils/prisma");
const skillSelect = { id: true, name: true, description: true, category: true };
const teachingSkillSelect = {
    id: true, description: true, yearsOfExperience: true, isVerified: true,
    createdAt: true, updatedAt: true, skill: { select: skillSelect }
};
const learningGoalSelect = {
    id: true, description: true, targetLevel: true, isActive: true,
    createdAt: true, updatedAt: true, skill: { select: skillSelect }
};
const currentUserSelect = {
    id: true, email: true, firstName: true, lastName: true,
    bio: true, avatarUrl: true, bannerUrl: true, availability: true,
    role: true, status: true, credits: true, averageRating: true, totalRatings: true,
    teachingSkills: { select: teachingSkillSelect, orderBy: { createdAt: "desc" } },
    learningGoals: { where: { isActive: true }, select: learningGoalSelect, orderBy: { createdAt: "desc" } },
    createdAt: true, updatedAt: true
};
const publicUserSelect = {
    id: true, firstName: true, lastName: true, bio: true,
    avatarUrl: true, availability: true, averageRating: true, totalRatings: true,
    teachingSkills: { select: teachingSkillSelect, orderBy: { createdAt: "desc" } },
    learningGoals: { where: { isActive: true }, select: learningGoalSelect, orderBy: { createdAt: "desc" } },
    createdAt: true
};
const ensureActiveUser = async (userId) => {
    const user = await prisma_1.prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
    if (!user || user.status !== client_1.UserStatus.ACTIVE)
        throw new httpError_1.HttpError(404, "User not found");
};
const getCurrentUserProfile = async (userId) => {
    const user = await prisma_1.prisma.user.findUnique({ where: { id: userId }, select: currentUserSelect });
    if (!user || user.status !== client_1.UserStatus.ACTIVE)
        throw new httpError_1.HttpError(404, "User not found");
    return user;
};
exports.getCurrentUserProfile = getCurrentUserProfile;
const getPublicUserProfile = async (userId) => {
    const user = await prisma_1.prisma.user.findUnique({ where: { id: userId }, select: publicUserSelect });
    if (!user)
        throw new httpError_1.HttpError(404, "User not found");
    return user;
};
exports.getPublicUserProfile = getPublicUserProfile;
const updateUserProfile = async (userId, input) => {
    await ensureActiveUser(userId);
    const data = {};
    if (input.firstName !== undefined)
        data.firstName = input.firstName;
    if (input.lastName !== undefined)
        data.lastName = input.lastName;
    if (input.bio !== undefined)
        data.bio = input.bio;
    if (input.avatarUrl !== undefined)
        data.avatarUrl = input.avatarUrl;
    if (input.bannerUrl !== undefined)
        data.bannerUrl = input.bannerUrl;
    if (input.availability !== undefined)
        data.availability = input.availability;
    const user = await prisma_1.prisma.user.update({ where: { id: userId }, data, select: currentUserSelect });
    return user;
};
exports.updateUserProfile = updateUserProfile;
const addUserSkill = async (userId, input) => {
    await ensureActiveUser(userId);
    let skill = input.skillId
        ? await prisma_1.prisma.skill.findUnique({ where: { id: input.skillId } })
        : await prisma_1.prisma.skill.findFirst({ where: { name: { equals: input.name, mode: "insensitive" } } });
    if (!skill) {
        skill = await prisma_1.prisma.skill.create({ data: { name: input.name, category: input.category ?? null, description: input.description ?? null } });
    }
    const userSkill = await prisma_1.prisma.userSkill.create({
        data: { userId, skillId: skill.id, description: input.description ?? null, yearsOfExperience: input.yearsOfExperience ?? null },
        select: teachingSkillSelect,
    });
    return userSkill;
};
exports.addUserSkill = addUserSkill;
const removeUserSkill = async (userId, userSkillId) => {
    const userSkill = await prisma_1.prisma.userSkill.findUnique({ where: { id: userSkillId }, select: { userId: true } });
    if (!userSkill)
        throw new httpError_1.HttpError(404, "Skill not found");
    if (userSkill.userId !== userId)
        throw new httpError_1.HttpError(403, "Forbidden");
    await prisma_1.prisma.userSkill.delete({ where: { id: userSkillId } });
};
exports.removeUserSkill = removeUserSkill;
const addLearningGoal = async (userId, input) => {
    await ensureActiveUser(userId);
    let skill = input.skillId
        ? await prisma_1.prisma.skill.findUnique({ where: { id: input.skillId } })
        : await prisma_1.prisma.skill.findFirst({ where: { name: { equals: input.name, mode: "insensitive" } } });
    if (!skill) {
        skill = await prisma_1.prisma.skill.create({ data: { name: input.name, category: null, description: input.description ?? null } });
    }
    const goal = await prisma_1.prisma.learningGoal.create({
        data: { userId, skillId: skill.id, description: input.description ?? null, targetLevel: input.targetLevel ?? null },
        select: learningGoalSelect,
    });
    return goal;
};
exports.addLearningGoal = addLearningGoal;
const removeLearningGoal = async (userId, goalId) => {
    const goal = await prisma_1.prisma.learningGoal.findUnique({ where: { id: goalId }, select: { userId: true } });
    if (!goal)
        throw new httpError_1.HttpError(404, "Learning goal not found");
    if (goal.userId !== userId)
        throw new httpError_1.HttpError(403, "Forbidden");
    await prisma_1.prisma.learningGoal.delete({ where: { id: goalId } });
};
exports.removeLearningGoal = removeLearningGoal;
const searchUsers = async (params) => {
    const where = { status: client_1.UserStatus.ACTIVE };
    if (params.query) {
        where.OR = [
            { firstName: { contains: params.query, mode: "insensitive" } },
            { lastName: { contains: params.query, mode: "insensitive" } },
        ];
    }
    if (params.skill) {
        where.teachingSkills = { some: { skill: { name: { contains: params.skill, mode: "insensitive" } } } };
    }
    return prisma_1.prisma.user.findMany({ where, select: publicUserSelect, take: params.limit ?? 50, orderBy: { createdAt: "desc" } });
};
exports.searchUsers = searchUsers;
//# sourceMappingURL=userService.js.map