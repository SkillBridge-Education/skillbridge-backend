"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUserRatingSummary = exports.getUserRatings = exports.createSessionRating = void 0;
const client_1 = require("@prisma/client");
const httpError_1 = require("../utils/httpError");
const prisma_1 = require("../utils/prisma");
const ratingSelect = {
    id: true,
    sessionId: true,
    reviewerId: true,
    reviewedUserId: true,
    rating: true,
    comment: true,
    createdAt: true,
    reviewer: {
        select: {
            id: true,
            firstName: true,
            lastName: true
        }
    },
    reviewedUser: {
        select: {
            id: true,
            firstName: true,
            lastName: true
        }
    },
    session: {
        select: {
            id: true,
            title: true,
            startsAt: true,
            actualEndedAt: true
        }
    }
};
const normalizeComment = (comment) => {
    if (comment === undefined || comment === null) {
        return null;
    }
    const trimmed = comment.trim();
    return trimmed.length > 0 ? trimmed : null;
};
const updateUserRatingStats = async (transaction, userId) => {
    await transaction.$queryRaw(client_1.Prisma.sql `SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`);
    const aggregate = await transaction.sessionRating.aggregate({
        where: { reviewedUserId: userId },
        _avg: { rating: true },
        _count: { rating: true }
    });
    await transaction.user.update({
        where: { id: userId },
        data: {
            averageRating: aggregate._avg.rating ?? 0,
            totalRatings: aggregate._count.rating
        }
    });
};
const createSessionRating = async ({ sessionId, reviewerId, reviewedUserId, rating, comment }) => {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        throw new httpError_1.HttpError(400, "rating must be an integer between 1 and 5");
    }
    if (!reviewedUserId.trim()) {
        throw new httpError_1.HttpError(400, "reviewedUserId is required");
    }
    if (reviewerId === reviewedUserId) {
        throw new httpError_1.HttpError(400, "Users cannot rate themselves");
    }
    try {
        return await prisma_1.prisma.$transaction(async (transaction) => {
            const session = await transaction.teachingSession.findUnique({
                where: { id: sessionId },
                select: {
                    id: true,
                    teacherId: true,
                    learnerId: true,
                    status: true
                }
            });
            if (!session) {
                throw new httpError_1.HttpError(404, "Session not found");
            }
            if (session.status !== client_1.TeachingSessionStatus.COMPLETED) {
                throw new httpError_1.HttpError(400, "Only completed sessions can be rated");
            }
            const participantIds = [session.teacherId, session.learnerId];
            if (!participantIds.includes(reviewerId)) {
                throw new httpError_1.HttpError(403, "Only session participants can submit ratings");
            }
            if (!participantIds.includes(reviewedUserId)) {
                throw new httpError_1.HttpError(400, "Reviewed user must be a session participant");
            }
            const created = await transaction.sessionRating.create({
                data: {
                    sessionId,
                    reviewerId,
                    reviewedUserId,
                    rating,
                    comment: normalizeComment(comment)
                },
                select: ratingSelect
            });
            await updateUserRatingStats(transaction, reviewedUserId);
            return created;
        });
    }
    catch (error) {
        if (error instanceof client_1.Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            throw new httpError_1.HttpError(409, "User has already rated this participant for this session");
        }
        throw error;
    }
};
exports.createSessionRating = createSessionRating;
const getUserRatings = async (userId) => {
    const user = await prisma_1.prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            averageRating: true,
            totalRatings: true
        }
    });
    if (!user) {
        throw new httpError_1.HttpError(404, "User not found");
    }
    const ratings = await prisma_1.prisma.sessionRating.findMany({
        where: { reviewedUserId: userId },
        select: ratingSelect,
        orderBy: { createdAt: "desc" }
    });
    return {
        averageRating: user.averageRating,
        totalRatings: user.totalRatings,
        ratings
    };
};
exports.getUserRatings = getUserRatings;
const getUserRatingSummary = async (userId) => {
    const user = await prisma_1.prisma.user.findUnique({
        where: { id: userId },
        select: {
            averageRating: true,
            totalRatings: true
        }
    });
    if (!user) {
        throw new httpError_1.HttpError(404, "User not found");
    }
    return user;
};
exports.getUserRatingSummary = getUserRatingSummary;
//# sourceMappingURL=ratingService.js.map