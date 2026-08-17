import { Server as HttpServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import { UserStatus } from "@prisma/client";
import { verifyToken } from "../utils/jwt";
import { env } from "../utils/env";
import { prisma } from "../utils/prisma";

interface AuthenticatedSocket extends Socket {
  userId?: string;
}

let io: SocketIOServer | undefined;

const userRoom = (userId: string): string => `user:${userId}`;

// Every connection joins a room named after its user id, so controllers/services
// can emit to a specific user without tracking socket ids themselves.
export const initSockets = (httpServer: HttpServer): SocketIOServer => {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: env.corsOrigin,
      credentials: true,
    },
  });

  io.use((socket: AuthenticatedSocket, next) => {
    const token =
      (socket.handshake.auth?.token as string | undefined) ??
      socket.handshake.headers.authorization?.split(" ")[1];

    if (!token) {
      next(new Error("Authentication required"));
      return;
    }

    void (async () => {
      try {
        const payload = verifyToken(token);

        // Re-read the account from the database rather than trusting the token,
        // exactly like the HTTP authenticate middleware. Without this a
        // suspended user keeps their socket and keeps receiving live events
        // until their token happens to expire.
        const user = await prisma.user.findUnique({
          where: { id: payload.userId },
          select: { id: true, status: true },
        });

        if (!user || user.status !== UserStatus.ACTIVE) {
          next(new Error("Invalid or expired token"));
          return;
        }

        socket.userId = user.id;
        next();
      } catch {
        next(new Error("Invalid or expired token"));
      }
    })();
  });

  io.on("connection", (socket: AuthenticatedSocket) => {
    if (socket.userId) {
      socket.join(userRoom(socket.userId));
    }
  });

  return io;
};

export const getIO = (): SocketIOServer | undefined => io;

export const emitToUser = (userId: string, event: string, payload: unknown): void => {
  io?.to(userRoom(userId)).emit(event, payload);
};

/**
 * Drops a user's live connections. The socket middleware only re-checks the
 * account on connect, so a suspension applied mid-session would otherwise leave
 * an already-open socket receiving events. Call this whenever an account is
 * suspended or deleted.
 */
export const disconnectUser = (userId: string, reason: string): void => {
  const room = io?.sockets.adapter.rooms.get(userRoom(userId));
  if (!room) return;

  for (const socketId of room) {
    const socket = io?.sockets.sockets.get(socketId);
    socket?.emit("session:revoked", { reason });
    socket?.disconnect(true);
  }
};
