import { Server as HttpServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import { verifyToken } from "../utils/jwt";
import { env } from "../utils/env";

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

    try {
      const payload = verifyToken(token);
      socket.userId = payload.userId;
      next();
    } catch {
      next(new Error("Invalid or expired token"));
    }
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
