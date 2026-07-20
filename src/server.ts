import http from "http";
import app from "./app";
import { env } from "./utils/env";
import { initSockets } from "./sockets";

// server.ts only starts the HTTP server.
// Keeping startup separate from app.ts makes the Express app easier to test.
const httpServer = http.createServer(app);
initSockets(httpServer);

httpServer.listen(env.port, () => {
  console.log(`API server is running on port ${env.port}`);
});
