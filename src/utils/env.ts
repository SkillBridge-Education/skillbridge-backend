import dotenv = require("dotenv");

dotenv.config();

const parsePort = (value: string | undefined): number => {
  const port = Number(value ?? "5000");
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("PORT must be a positive integer");
  }
  return port;
};

const parseCorsOrigin = (value: string | undefined): string | string[] => {
  if (!value) return "http://localhost:5173";
  const origins = value.split(",").map((o) => o.trim()).filter(Boolean);
  return origins.length === 1 ? origins[0] : origins;
};

const nodeEnv = process.env.NODE_ENV ?? "development";
const developmentJwtSecret = "development-only-secret-change-me";

const parseJwtSecret = (value: string | undefined): string => {
  const secret = value?.trim();
  if (nodeEnv === "production") {
    if (!secret || secret.length < 32 || secret === developmentJwtSecret || secret === "change-me-in-production") {
      throw new Error("JWT_SECRET must be set to a secure value of at least 32 characters in production");
    }
  }
  return secret || developmentJwtSecret;
};

const parseUrl = (value: string | undefined, fallback: string): string => {
  const url = value?.trim() || fallback;
  try {
    return new URL(url).toString().replace(/\/$/, "");
  } catch {
    throw new Error(`Invalid URL value: ${url}`);
  }
};

export const env = {
  nodeEnv,
  port:       parsePort(process.env.PORT),
  corsOrigin: parseCorsOrigin(process.env.CORS_ORIGIN),
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret:   parseJwtSecret(process.env.JWT_SECRET),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  appUrl:      parseUrl(process.env.APP_URL, `http://localhost:${parsePort(process.env.PORT)}`),
  frontendUrl: parseUrl(process.env.FRONTEND_URL, "http://localhost:5173"),
  gmailUser:         process.env.GMAIL_USER ?? "",
  gmailAppPassword:  process.env.GMAIL_APP_PASSWORD ?? "",
  requireEmailVerification: process.env.REQUIRE_EMAIL_VERIFICATION === "true",

  /**
   * Paiement. Vides = achat desactive, et rien d'autre ne change.
   *
   * La cle secrete ne quitte jamais ce serveur. La cle publiable, elle, est
   * faite pour etre exposee -- mais l'application n'en a meme pas besoin :
   * c'est Stripe qui heberge la page de paiement, et le serveur ne renvoie
   * qu'une adresse a ouvrir.
   *
   * Le secret du webhook est distinct de la cle secrete : il sert uniquement a
   * verifier que les notifications viennent bien de Stripe. Sans lui, la route
   * est publique et n'importe qui pourrait s'attribuer des credits.
   */
  stripeSecretKey: process.env.STRIPE_SECRET_KEY?.trim() || "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET?.trim() || "",
  logLevel: process.env.LOG_LEVEL,
  // Empty means error tracking stays off; nothing else changes.
  sentryDsn: process.env.SENTRY_DSN?.trim() || "",
  // Where re-encoded uploads are written. Outside the source tree in production.
  uploadDir: process.env.UPLOAD_DIR?.trim() || "",
  // Comma-separated hostnames allowed to serve chat attachments. Empty means
  // "any https host", which is only acceptable until file storage is set up.
  allowedFileHosts: (process.env.ALLOWED_FILE_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean),
};
