import cors = require("cors");
import express = require("express");
import helmet from "helmet";
import { errorMiddleware } from "./middleware/errorMiddleware";
import { globalRateLimiter } from "./middleware/rateLimit";
import { logger } from "./utils/logger";
import { pinoHttp } from "pino-http";
import routes from "./routes";
import { env } from "./utils/env";

const app = express();

app.use(helmet());

// Structured request logging with a per-request id, so a report from a user can
// be traced to the exact request. Silent under test to keep output readable.
if (process.env.NODE_ENV !== "test") {
  app.use(pinoHttp({ logger }));
}

// CORS controls which frontend applications are allowed to call this API.
app.use(
  cors({
    origin: env.corsOrigin,
    credentials: true
  })
);

// express.json() allows Express to read JSON request bodies from clients.
// The size cap stops a single request from exhausting memory.
app.use(express.json({ limit: "100kb" }));

// Trust the reverse proxy so rate limiting keys on the real client IP rather
// than the proxy's. Without this every user behind the proxy shares one bucket.
app.set("trust proxy", 1);

// Baseline limit for every route. Stricter limits are applied per-route on top.
app.use(globalRateLimiter);

// Keep route registration in one place so new feature routes are easy to add.
app.use(routes);

// Error middleware must be registered after routes so it can catch route errors.
app.use(errorMiddleware);

export default app;
