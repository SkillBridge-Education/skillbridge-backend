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
  logLevel: process.env.LOG_LEVEL,
};
