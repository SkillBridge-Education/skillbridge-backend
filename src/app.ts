import cors = require("cors");
import express = require("express");
import helmet from "helmet";
import { errorMiddleware } from "./middleware/errorMiddleware";
import { globalRateLimiter } from "./middleware/rateLimit";
import { logger } from "./utils/logger";
import { pinoHttp } from "pino-http";
import routes from "./routes";
import { stripeWebhookRouter } from "./routes/paymentRoutes";
import { env } from "./utils/env";
import { uploadDirectory } from "./services/uploadService";

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

/**
 * La notification de paiement, montee AVANT le parseur JSON.
 *
 * Stripe signe le corps brut de la requete. Si express.json() l'a deja parse,
 * le corps disponible est un objet : la signature calculee dessus ne
 * correspondra jamais, et l'integration echouera avec un « signature
 * invalide » permanent qu'aucune verification du secret n'explique.
 *
 * C'est la raison, et la seule, pour laquelle cette route ne vit pas avec les
 * autres.
 */
app.use("/payments", stripeWebhookRouter);

// express.json() allows Express to read JSON request bodies from clients.
// The size cap stops a single request from exhausting memory.
app.use(express.json({ limit: "100kb" }));

// Trust the reverse proxy so rate limiting keys on the real client IP rather
// than the proxy's. Without this every user behind the proxy shares one bucket.
app.set("trust proxy", 1);

// Baseline limit for every route. Stricter limits are applied per-route on top.
app.use(globalRateLimiter);

// Uploaded media. What is served here is always a file this server produced —
// every image is decoded and re-encoded before being written, so the original
// bytes a client sent never reach disk. `index: false` keeps the directory from
// being browsable.
app.use(
  "/uploads",
  express.static(uploadDirectory(), { maxAge: "7d", index: false })
);

// Keep route registration in one place so new feature routes are easy to add.
app.use(routes);

// Error middleware must be registered after routes so it can catch route errors.
app.use(errorMiddleware);

export default app;
