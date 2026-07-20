"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateMatchStatus = exports.getMyMatches = exports.requestMatch = exports.getMatchSuggestions = void 0;
const client_1 = require("@prisma/client");
const httpError_1 = require("../utils/httpError");
const prisma_1 = require("../utils/prisma");
const notificationsService_1 = require("./notificationsService");
const skillSelect = {
    id: true,
    name: true,
    description: true,
    category: true
};
const matchingTeachingSkillSelect = {
    id: true,
    description: true,
    yearsOfExperience: true,
    isVerified: true,
    skill: {
        select: skillSelect
    }
};
const matchedUserSelect = {
    id: true,
    firstName: true,
    lastName: true,
    bio: true,
    avatarUrl: true,
    availability: true,
    teachingSkills: {
        select: matchingTeachingSkillSelect
    },
    learningGoals: {
        where: { isActive: true },
        select: {
            id: true,
            skill: { select: skillSelect }
        }
    }
};
const matchUserSelect = {
    id: true,
    firstName: true,
    lastName: true,
    bio: true,
    avatarUrl: true,
    availability: true,
    teachingSkills: {
        select: matchingTeachingSkillSelect,
        orderBy: {
            createdAt: "desc"
        }
    },
    learningGoals: {
        where: { isActive: true },
        select: {
            id: true,
            description: true,
            targetLevel: true,
            skill: {
                select: skillSelect
            }
        },
        orderBy: {
            createdAt: "desc"
        }
    }
};
const matchSelect = {
    id: true,
    requesterId: true,
    receiverId: true,
    skillId: true,
    status: true,
    message: true,
    requester: {
        select: matchUserSelect
    },
    receiver: {
        select: matchUserSelect
    },
    skill: {
        select: skillSelect
    },
    conversation: {
        select: {
            id: true,
            status: true
        }
    },
    createdAt: true,
    updatedAt: true
};
const ensureActiveUser = async (userId) => {
    const user = await prisma_1.prisma.user.findFirst({
        where: {
            id: userId,
            status: client_1.UserStatus.ACTIVE
        },
        select: { id: true }
    });
    if (!user) {
        throw new httpError_1.HttpError(404, "User not found");
    }
};
const getMatchSuggestions = async (userId) => {
    const currentUser = await prisma_1.prisma.user.findFirst({
        where: {
            id: userId,
            status: client_1.UserStatus.ACTIVE
        },
        select: {
            learningGoals: {
                where: {
                    isActive: true,
                    skill: {
                        isActive: true
                    }
                },
                select: {
                    skillId: true
                }
            }
        }
    });
    if (!currentUser) {
        throw new httpError_1.HttpError(404, "User not found");
    }
    // MVP rule: a user is compatible when they teach a skill the current user wants to learn.
    const learningSkillIds = currentUser.learningGoals.map((goal) => goal.skillId);
    if (learningSkillIds.length === 0) {
        return [];
    }
    return prisma_1.prisma.user.findMany({
        where: {
            id: {
                not: userId
            },
            status: client_1.UserStatus.ACTIVE,
            teachingSkills: {
                some: {
                    skillId: {
                        in: learningSkillIds
                    },
                    skill: {
                        isActive: true
                    }
                }
            }
        },
        select: {
            ...matchedUserSelect,
            teachingSkills: {
                where: {
                    skill: {
                        isActive: true
                    }
                },
                select: matchingTeachingSkillSelect,
                orderBy: {
                    createdAt: "desc"
                }
            }
        },
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
        take: 20
    });
};
exports.getMatchSuggestions = getMatchSuggestions;
const requestMatch = async (input) => {
    const receiverId = input.receiverId.trim();
    const skillId = input.skillId?.trim() || null;
    if (!receiverId) {
        throw new httpError_1.HttpError(400, "receiverId is required");
    }
    if (receiverId === input.requesterId) {
        throw new httpError_1.HttpError(400, "You cannot request a match with yourself");
    }
    await ensureActiveUser(input.requesterId);
    await ensureActiveUser(receiverId);
    if (skillId) {
        const skill = await prisma_1.prisma.skill.findFirst({
            where: {
                id: skillId,
                isActive: true
            },
            select: { id: true }
        });
        if (!skill) {
            throw new httpError_1.HttpError(404, "Skill not found");
        }
    }
    const existing = await prisma_1.prisma.match.findFirst({
        where: {
            requesterId: input.requesterId,
            receiverId,
            skillId,
            status: {
                in: [client_1.MatchStatus.PENDING, client_1.MatchStatus.ACCEPTED]
            }
        },
        select: { id: true }
    });
    if (existing) {
        throw new httpError_1.HttpError(409, "Match request already exists");
    }
    const match = await prisma_1.prisma.match.create({
        data: {
            requesterId: input.requesterId,
            receiverId,
            skillId,
            message: input.message?.trim() || undefined
        },
        select: matchSelect
    });
    // Notifier le destinataire d'une nouvelle demande de connexion
    (0, notificationsService_1.createNotificationService)(receiverId, "CONNECTION_REQUEST", `${match.requester.firstName} ${match.requester.lastName} veut se connecter avec vous.`).catch(() => { });
    return match;
};
exports.requestMatch = requestMatch;
const getMyMatches = async (userId) => {
    await ensureActiveUser(userId);
    return prisma_1.prisma.match.findMany({
        where: {
            OR: [{ requesterId: userId }, { receiverId: userId }]
        },
        select: matchSelect,
        orderBy: {
            createdAt: "desc"
        }
    });
};
exports.getMyMatches = getMyMatches;
const updateMatchStatus = async (userId, matchId, status) => {
    await ensureActiveUser(userId);
    if (status !== client_1.MatchStatus.ACCEPTED &&
        status !== client_1.MatchStatus.REJECTED &&
        status !== client_1.MatchStatus.CANCELLED) {
        throw new httpError_1.HttpError(400, "Unsupported match status");
    }
    const match = await prisma_1.prisma.match.findFirst({
        where: { id: matchId }
    });
    if (!match) {
        throw new httpError_1.HttpError(404, "Match not found");
    }
    if (status === client_1.MatchStatus.CANCELLED && match.requesterId !== userId) {
        throw new httpError_1.HttpError(403, "Only the requester can cancel this match");
    }
    if ((status === client_1.MatchStatus.ACCEPTED || status === client_1.MatchStatus.REJECTED) &&
        match.receiverId !== userId) {
        throw new httpError_1.HttpError(403, "Only the receiver can accept or reject this match");
    }
    if (match.status !== client_1.MatchStatus.PENDING) {
        throw new httpError_1.HttpError(409, "Only pending matches can be updated");
    }
    return prisma_1.prisma.$transaction(async (tx) => {
        const updated = await tx.match.update({
            where: { id: matchId },
            data: { status },
            select: matchSelect
        });
        if (status === client_1.MatchStatus.ACCEPTED) {
            const firstUserId = match.requesterId < match.receiverId ? match.requesterId : match.receiverId;
            const secondUserId = match.requesterId < match.receiverId ? match.receiverId : match.requesterId;
            await tx.conversation.upsert({
                where: { matchId },
                update: { status: "ACTIVE" },
                create: {
                    matchId,
                    firstUserId,
                    secondUserId
                }
            });
            const acceptedMatch = await tx.match.findUnique({
                where: { id: matchId },
                select: matchSelect
            });
            // Notifier le demandeur que sa demande a été acceptée
            if (acceptedMatch) {
                (0, notificationsService_1.createNotificationService)(match.requesterId, "CONNECTION_ACCEPTED", `${acceptedMatch.receiver.firstName} ${acceptedMatch.receiver.lastName} a accepté votre demande de connexion.`).catch(() => { });
            }
            return acceptedMatch;
        }
        return updated;
    });
};
exports.updateMatchStatus = updateMatchStatus;
//# sourceMappingURL=matchService.js.map