"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emitToUser = exports.getIO = exports.initSockets = void 0;
const socket_io_1 = require("socket.io");
const jwt_1 = require("../utils/jwt");
const env_1 = require("../utils/env");
let io;
const userRoom = (userId) => `user:${userId}`;
// Every connection joins a room named after its user id, so controllers/services
// can emit to a specific user without tracking socket ids themselves.
const initSockets = (httpServer) => {
    io = new socket_io_1.Server(httpServer, {
        cors: {
            origin: env_1.env.corsOrigin,
            credentials: true,
        },
    });
    io.use((socket, next) => {
        const token = socket.handshake.auth?.token ??
            socket.handshake.headers.authorization?.split(" ")[1];
        if (!token) {
            next(new Error("Authentication required"));
            return;
        }
        try {
            const payload = (0, jwt_1.verifyToken)(token);
            socket.userId = payload.userId;
            next();
        }
        catch {
            next(new Error("Invalid or expired token"));
        }
    });
    io.on("connection", (socket) => {
        if (socket.userId) {
            socket.join(userRoom(socket.userId));
        }
    });
    return io;
};
exports.initSockets = initSockets;
const getIO = () => io;
exports.getIO = getIO;
const emitToUser = (userId, event, payload) => {
    io?.to(userRoom(userId)).emit(event, payload);
};
exports.emitToUser = emitToUser;
//# sourceMappingURL=index.js.map