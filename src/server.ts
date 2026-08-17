import http from "http";
import app from "./app";
import { env } from "./utils/env";
import { initSockets } from "./sockets";
import { logger } from "./utils/logger";
import { prisma } from "./utils/prisma";

// server.ts only starts the HTTP server.
// Keeping startup separate from app.ts makes the Express app easier to test.
const httpServer = http.createServer(app);
initSockets(httpServer);

httpServer.listen(env.port, () => {
  logger.info({ port: env.port }, "API server started");
});

/**
 * Without this, every deploy severs in-flight requests and leaves Prisma
 * connections dangling. Stop accepting new connections, let running requests
 * finish, then close the database pool.
 */
const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, "Shutting down");

  // Force-exit if a hung connection keeps the server from closing.
  const forceExit = setTimeout(() => {
    logger.error("Graceful shutdown timed out, forcing exit");
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  try {
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => (err ? reject(err) : resolve()));
    });
    await prisma.$disconnect();
    logger.info("Shutdown complete");
    process.exit(0);
  } catch (error) {
    logger.error({ error }, "Error during shutdown");
    process.exit(1);
  }
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// A rejection that reaches this point means a bug: log it with context rather
// than letting Node print a bare stack trace and keep running in a bad state.
process.on("unhandledRejection", (reason) => {
  logger.fatal({ reason }, "Unhandled promise rejection");
  void shutdown("unhandledRejection");
});
