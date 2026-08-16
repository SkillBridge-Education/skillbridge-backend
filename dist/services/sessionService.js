"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getParticipantsSessionService = exports.removeParticipantSessionService = exports.addParticipantSessionService = exports.updateSessionService = exports.createGroupSessionService = exports.refuseSessionService = exports.acceptSessionService = exports.joinSessionService = exports.endSessionService = exports.createSessionService = void 0;
const uuid_1 = require("uuid");
const prisma_1 = require("../utils/prisma");
const httpError_1 = require("../utils/httpError");
const notificationsService_1 = require("./notificationsService");
const creditService_1 = require("./creditService");
const sockets_1 = require("../sockets");
const emitSessionUpdate = (session) => {
    (0, sockets_1.emitToUser)(session.teacherId, "session:update", session);
    (0, sockets_1.emitToUser)(session.learnerId, "session:update", session);
};
const createSessionService = async (teacherId, learnerId, title, estimatedDuration, scheduledAt) => {
    const learner = await prisma_1.prisma.user.findUnique({
        where: { id: learnerId },
        select: { id: true },
    });
    if (!learner)
        throw new httpError_1.HttpError(404, "Learner not found");
    const jitsiRoomId = `skillbridge-${(0, uuid_1.v4)()}`;
    const session = await prisma_1.prisma.teachingSession.create({
        data: {
            jitsiRoomId,
            teacherId,
            learnerId,
            title,
            creditsReserved: estimatedDuration,
            startsAt: scheduledAt,
            status: "PENDING_CONFIRMATION",
        },
    });
    (0, notificationsService_1.createNotificationService)(learnerId, "SESSION_BOOKED", `Proposition de session "${title}" reçue. ${estimatedDuration} crédits requis pour accepter. Acceptez ou refusez.`).catch(() => { });
    emitSessionUpdate(session);
    return session;
};
exports.createSessionService = createSessionService;
const endSessionService = async (sessionId, userId, durationSeconds) => {
    const session = await prisma_1.prisma.teachingSession.findUnique({
        where: { id: sessionId },
        select: {
            teacherId: true,
            learnerId: true,
            creditsReserved: true,
            status: true,
        },
    });
    if (!session)
        throw new httpError_1.HttpError(404, "Session not found");
    if (session.teacherId !== userId && session.learnerId !== userId) {
        throw new httpError_1.HttpError(403, "User is not part of this session");
    }
    if (session.status !== "ACTIVE") {
        throw new httpError_1.HttpError(400, "Session is not active");
    }
    const minutesElapsed = Math.ceil(durationSeconds / 60);
    const teacherCreditsPaid = Math.min(minutesElapsed, session.creditsReserved);
    const learnerCreditsRefunded = session.creditsReserved - teacherCreditsPaid;
    // grantCredits caps at MAX_CREDITS; a raw increment would break the
    // "User_credits_bounds_check" constraint and roll back the whole settlement.
    await prisma_1.prisma.$transaction(async (tx) => {
        await (0, creditService_1.grantCredits)(tx, session.teacherId, teacherCreditsPaid);
        if (learnerCreditsRefunded > 0) {
            await (0, creditService_1.grantCredits)(tx, session.learnerId, learnerCreditsRefunded);
        }
        await tx.teachingSession.update({
            where: { id: sessionId },
            data: {
                status: "COMPLETED",
                actualEndedAt: new Date(),
                creditsConsumed: teacherCreditsPaid,
            },
        });
    });
    emitSessionUpdate({
        id: sessionId,
        teacherId: session.teacherId,
        learnerId: session.learnerId,
        status: "COMPLETED",
    });
    return { teacherCreditsPaid, learnerCreditsRefunded };
};
exports.endSessionService = endSessionService;
const joinSessionService = async (sessionId, userId) => {
    const session = await prisma_1.prisma.teachingSession.findUnique({
        where: { id: sessionId },
        select: {
            teacherId: true,
            learnerId: true,
            status: true,
            jitsiRoomId: true,
        },
    });
    if (!session)
        throw new httpError_1.HttpError(404, "Session not found");
    if (session.teacherId !== userId && session.learnerId !== userId) {
        throw new httpError_1.HttpError(403, "User is not part of this session");
    }
    if (session.status === "COMPLETED" || session.status === "CANCELLED") {
        throw new httpError_1.HttpError(400, "Session has already ended");
    }
    if (session.status === "PENDING_CONFIRMATION") {
        throw new httpError_1.HttpError(400, "Session is awaiting learner confirmation");
    }
    if (session.status === "SCHEDULED") {
        await prisma_1.prisma.teachingSession.update({
            where: { id: sessionId },
            data: { status: "ACTIVE", actualStartedAt: new Date() },
        });
        emitSessionUpdate({
            id: sessionId,
            teacherId: session.teacherId,
            learnerId: session.learnerId,
            status: "ACTIVE",
        });
    }
    return session.jitsiRoomId;
};
exports.joinSessionService = joinSessionService;
const acceptSessionService = async (sessionId, learnerId) => {
    const session = await prisma_1.prisma.teachingSession.findUnique({
        where: { id: sessionId },
        select: { teacherId: true, learnerId: true, status: true, title: true, creditsReserved: true },
    });
    if (!session)
        throw new httpError_1.HttpError(404, "Session not found");
    if (session.learnerId !== learnerId) {
        throw new httpError_1.HttpError(403, "Only the learner can accept this session");
    }
    if (session.status !== "PENDING_CONFIRMATION") {
        throw new httpError_1.HttpError(400, "Session is not pending confirmation");
    }
    // spendCredits throws 400 "User does not have enough credits" if insufficient
    const updated = await prisma_1.prisma.$transaction(async (tx) => {
        await (0, creditService_1.spendCredits)(tx, learnerId, session.creditsReserved);
        await tx.rewardTransaction.create({
            data: {
                userId: learnerId,
                amount: session.creditsReserved,
                type: "SPENT",
                description: `Réservation session acceptée : "${session.title}"`,
            },
        });
        return tx.teachingSession.update({
            where: { id: sessionId },
            data: { status: "SCHEDULED" },
        });
    });
    (0, notificationsService_1.createNotificationService)(session.teacherId, "SESSION_ACCEPTED", `Votre session "${session.title}" a été acceptée.`).catch(() => { });
    emitSessionUpdate({
        id: sessionId,
        teacherId: session.teacherId,
        learnerId: session.learnerId,
        status: updated.status,
    });
    return updated;
};
exports.acceptSessionService = acceptSessionService;
const refuseSessionService = async (sessionId, learnerId) => {
    const session = await prisma_1.prisma.teachingSession.findUnique({
        where: { id: sessionId },
        select: {
            teacherId: true,
            learnerId: true,
            status: true,
            title: true,
        },
    });
    if (!session)
        throw new httpError_1.HttpError(404, "Session not found");
    if (session.learnerId !== learnerId) {
        throw new httpError_1.HttpError(403, "Only the learner can refuse this session");
    }
    if (session.status !== "PENDING_CONFIRMATION") {
        throw new httpError_1.HttpError(400, "Session is not pending confirmation");
    }
    // No credits were debited at creation, so nothing to refund here.
    const updated = await prisma_1.prisma.teachingSession.update({
        where: { id: sessionId },
        data: { status: "CANCELLED" },
    });
    (0, notificationsService_1.createNotificationService)(session.teacherId, "SESSION_REFUSED", `Votre session "${session.title}" a été refusée par l'apprenant.`).catch(() => { });
    emitSessionUpdate({
        id: sessionId,
        teacherId: session.teacherId,
        learnerId: session.learnerId,
        status: updated.status,
    });
    return updated;
};
exports.refuseSessionService = refuseSessionService;
const createGroupSessionService = async (teacherId, learnerIds, title, estimatedDuration, scheduledAt) => {
    const learners = await prisma_1.prisma.user.findMany({
        where: { id: { in: learnerIds } },
        select: { id: true, credits: true },
    });
    if (learners.length !== learnerIds.length) {
        throw new httpError_1.HttpError(404, "One or more learners not found");
    }
    const jitsiRoomId = `skillbridge-${(0, uuid_1.v4)()}`;
    return prisma_1.prisma.$transaction(async (tx) => {
        for (const learner of learners) {
            // The balances read outside the transaction can be stale, so let
            // spendCredits do the check and the debit in a single atomic write.
            await (0, creditService_1.spendCredits)(tx, learner.id, estimatedDuration);
        }
        const session = await tx.teachingSession.create({
            data: {
                jitsiRoomId,
                teacherId,
                learnerId: learnerIds[0],
                title,
                startsAt: scheduledAt,
                creditsReserved: estimatedDuration * learnerIds.length,
            },
        });
        await tx.sessionParticipant.createMany({
            data: [
                { sessionId: session.id, userId: teacherId, role: "TEACHER" },
                ...learnerIds.map((id) => ({
                    sessionId: session.id,
                    userId: id,
                    role: "LEARNER",
                })),
            ],
        });
        return session;
    });
};
exports.createGroupSessionService = createGroupSessionService;
const updateSessionService = async (sessionId, teacherId, body) => {
    const session = await prisma_1.prisma.teachingSession.findUnique({
        where: { id: sessionId },
        select: {
            teacherId: true,
            learnerId: true,
            status: true,
            title: true,
            creditsReserved: true,
        },
    });
    if (!session)
        throw new httpError_1.HttpError(404, "Session not found");
    if (session.teacherId !== teacherId) {
        throw new httpError_1.HttpError(403, "Only the teacher can modify this session");
    }
    if (session.status !== "CANCELLED" && session.status !== "PENDING_CONFIRMATION") {
        throw new httpError_1.HttpError(400, "Only cancelled or pending sessions can be modified");
    }
    const newCredits = body.estimatedDuration !== undefined
        ? body.estimatedDuration
        : session.creditsReserved;
    // Credits are only debited at acceptance, not at creation/modification.
    // No credit movement needed here for PENDING or CANCELLED sessions.
    const updated = await prisma_1.prisma.teachingSession.update({
        where: { id: sessionId },
        data: {
            creditsReserved: newCredits,
            status: "PENDING_CONFIRMATION",
            ...(body.scheduledAt ? { startsAt: new Date(body.scheduledAt) } : {}),
            ...(body.title ? { title: body.title } : {}),
        },
    });
    (0, notificationsService_1.createNotificationService)(session.learnerId, "SESSION_BOOKED", `La session "${updated.title}" a été modifiée. ${updated.creditsReserved} crédits requis pour accepter. Confirmez ou refusez.`).catch(() => { });
    emitSessionUpdate({
        id: sessionId,
        teacherId: session.teacherId,
        learnerId: session.learnerId,
        status: updated.status,
    });
    return updated;
};
exports.updateSessionService = updateSessionService;
const addParticipantSessionService = async (sessionId, requesterId, userId) => {
    const session = await prisma_1.prisma.teachingSession.findUnique({
        where: { id: sessionId },
        select: { teacherId: true, status: true, creditsReserved: true },
    });
    if (!session)
        throw new httpError_1.HttpError(404, "Session not found");
    if (session.teacherId !== requesterId) {
        throw new httpError_1.HttpError(403, "Only the teacher can add participants");
    }
    if (session.status !== "SCHEDULED" && session.status !== "ACTIVE") {
        throw new httpError_1.HttpError(400, "Cannot add participants to a completed session");
    }
    const existing = await prisma_1.prisma.sessionParticipant.findUnique({
        where: { sessionId_userId: { sessionId, userId } },
    });
    if (existing)
        throw new httpError_1.HttpError(400, "User is already a participant");
    const learner = await prisma_1.prisma.user.findUnique({
        where: { id: userId },
        select: { credits: true },
    });
    if (!learner)
        throw new httpError_1.HttpError(404, "User not found");
    if (learner.credits < session.creditsReserved) {
        throw new httpError_1.HttpError(400, "User does not have enough credits");
    }
    return prisma_1.prisma.$transaction(async (tx) => {
        // spendCredits re-checks the balance atomically; the read above can go stale
        // between the check and the write when a user joins two sessions at once.
        await (0, creditService_1.spendCredits)(tx, userId, session.creditsReserved);
        return tx.sessionParticipant.create({
            data: { sessionId, userId, role: "LEARNER" },
        });
    });
};
exports.addParticipantSessionService = addParticipantSessionService;
const removeParticipantSessionService = async (sessionId, requesterId, userId) => {
    const session = await prisma_1.prisma.teachingSession.findUnique({
        where: { id: sessionId },
        select: { teacherId: true, status: true, creditsReserved: true },
    });
    if (!session)
        throw new httpError_1.HttpError(404, "Session not found");
    if (session.teacherId !== requesterId) {
        throw new httpError_1.HttpError(403, "Only the teacher can remove participants");
    }
    if (session.status !== "SCHEDULED") {
        throw new httpError_1.HttpError(400, "Cannot remove participants from a non-scheduled session");
    }
    const existing = await prisma_1.prisma.sessionParticipant.findUnique({
        where: { sessionId_userId: { sessionId, userId } },
    });
    if (!existing)
        throw new httpError_1.HttpError(404, "User is not a participant");
    return prisma_1.prisma.$transaction(async (tx) => {
        await (0, creditService_1.grantCredits)(tx, userId, session.creditsReserved);
        return tx.sessionParticipant.delete({
            where: { sessionId_userId: { sessionId, userId } },
        });
    });
};
exports.removeParticipantSessionService = removeParticipantSessionService;
const getParticipantsSessionService = async (sessionId, requesterId) => {
    const session = await prisma_1.prisma.teachingSession.findUnique({
        where: { id: sessionId },
        select: { teacherId: true, status: true },
    });
    if (!session)
        throw new httpError_1.HttpError(404, "Session not found");
    const participant = await prisma_1.prisma.sessionParticipant.findUnique({
        where: { sessionId_userId: { sessionId, userId: requesterId } },
    });
    if (!participant && session.teacherId !== requesterId) {
        throw new httpError_1.HttpError(403, "You are not a participant of this session");
    }
    return prisma_1.prisma.sessionParticipant.findMany({
        where: { sessionId },
        include: {
            user: {
                select: { id: true, firstName: true, lastName: true, avatarUrl: true },
            },
        },
    });
};
exports.getParticipantsSessionService = getParticipantsSessionService;
//# sourceMappingURL=sessionService.js.map