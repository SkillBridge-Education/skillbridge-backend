import { MatchStatus, Prisma, UserStatus } from "@prisma/client";
import { HttpError } from "../utils/httpError";
import { assertNotBlocked } from "./blockService";
import { prisma } from "../utils/prisma";
import { createNotificationService } from "./notificationsService";

const skillSelect = {
  id: true,
  name: true,
  description: true,
  category: true
} satisfies Prisma.SkillSelect;

const matchingTeachingSkillSelect = {
  id: true,
  description: true,
  yearsOfExperience: true,
  isVerified: true,
  skill: {
    select: skillSelect
  }
} satisfies Prisma.UserSkillSelect;

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
} satisfies Prisma.UserSelect;

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
} satisfies Prisma.UserSelect;

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
} satisfies Prisma.MatchSelect;

const ensureActiveUser = async (userId: string) => {
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      status: UserStatus.ACTIVE
    },
    select: { id: true }
  });

  if (!user) {
    throw new HttpError(404, "User not found");
  }
};

export const getMatchSuggestions = async (userId: string) => {
  const currentUser = await prisma.user.findFirst({
    where: {
      id: userId,
      status: UserStatus.ACTIVE
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
    throw new HttpError(404, "User not found");
  }

  // MVP rule: a user is compatible when they teach a skill the current user wants to learn.
  const learningSkillIds = currentUser.learningGoals.map((goal) => goal.skillId);

  if (learningSkillIds.length === 0) {
    return [];
  }

  return prisma.user.findMany({
    where: {
      id: {
        not: userId
      },
      status: UserStatus.ACTIVE,
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

export const requestMatch = async (input: {
  requesterId: string;
  receiverId: string;
  skillId?: string;
  message?: string;
}) => {
  const receiverId = input.receiverId.trim();
  const skillId = input.skillId?.trim() || null;

  if (!receiverId) {
    throw new HttpError(400, "receiverId is required");
  }

  if (receiverId === input.requesterId) {
    throw new HttpError(400, "You cannot request a match with yourself");
  }

  await ensureActiveUser(input.requesterId);
  await ensureActiveUser(receiverId);
  // A blocked account could send connection requests until now: the block row
  // was written and read by nothing.
  await assertNotBlocked(input.requesterId, receiverId);

  if (skillId) {
    const skill = await prisma.skill.findFirst({
      where: {
        id: skillId,
        isActive: true
      },
      select: { id: true }
    });

    if (!skill) {
      throw new HttpError(404, "Skill not found");
    }
  }

  const existing = await prisma.match.findFirst({
    where: {
      requesterId: input.requesterId,
      receiverId,
      skillId,
      status: {
        in: [MatchStatus.PENDING, MatchStatus.ACCEPTED]
      }
    },
    select: { id: true }
  });

  if (existing) {
    throw new HttpError(409, "Match request already exists");
  }

  const match = await prisma.match.create({
    data: {
      requesterId: input.requesterId,
      receiverId,
      skillId,
      message: input.message?.trim() || undefined
    },
    select: matchSelect
  });

  // Notifier le destinataire d'une nouvelle demande de connexion
  createNotificationService(
    receiverId,
    "CONNECTION_REQUEST",
    `${match.requester.firstName} ${match.requester.lastName} veut se connecter avec vous.`
  ).catch(() => {});

  return match;
};

export const getMyMatches = async (userId: string) => {
  await ensureActiveUser(userId);

  return prisma.match.findMany({
    where: {
      OR: [{ requesterId: userId }, { receiverId: userId }]
    },
    select: matchSelect,
    orderBy: {
      createdAt: "desc"
    }
  });
};

export const updateMatchStatus = async (
  userId: string,
  matchId: string,
  status: MatchStatus
) => {
  await ensureActiveUser(userId);

  if (
    status !== MatchStatus.ACCEPTED &&
    status !== MatchStatus.REJECTED &&
    status !== MatchStatus.CANCELLED
  ) {
    throw new HttpError(400, "Unsupported match status");
  }

  const match = await prisma.match.findFirst({
    where: { id: matchId }
  });

  if (!match) {
    throw new HttpError(404, "Match not found");
  }

  if (status === MatchStatus.CANCELLED && match.requesterId !== userId) {
    throw new HttpError(403, "Only the requester can cancel this match");
  }

  if (
    (status === MatchStatus.ACCEPTED || status === MatchStatus.REJECTED) &&
    match.receiverId !== userId
  ) {
    throw new HttpError(403, "Only the receiver can accept or reject this match");
  }

  if (match.status !== MatchStatus.PENDING) {
    throw new HttpError(409, "Only pending matches can be updated");
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.match.update({
      where: { id: matchId },
      data: { status },
      select: matchSelect
    });

    if (status === MatchStatus.ACCEPTED) {
      const firstUserId =
        match.requesterId < match.receiverId ? match.requesterId : match.receiverId;
      const secondUserId =
        match.requesterId < match.receiverId ? match.receiverId : match.requesterId;

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
        createNotificationService(
          match.requesterId,
          "CONNECTION_ACCEPTED",
          `${acceptedMatch.receiver.firstName} ${acceptedMatch.receiver.lastName} a accepté votre demande de connexion.`
        ).catch(() => {});
      }

      return acceptedMatch;
    }

    return updated;
  });
};