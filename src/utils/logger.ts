import pino from "pino";
import { env } from "./env";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Structured logger. JSON in production so logs are queryable, pretty-printed
 * locally so they stay readable.
 *
 * Never log credentials or personal data: the redact list below covers the
 * headers and fields that carry them, and it is the reason request logging goes
 * through pino-http rather than console.log.
 */
export const logger = pino({
  level: env.logLevel ?? (isProduction ? "info" : "debug"),
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.body.password",
      "req.body.currentPassword",
      "req.body.newPassword",
      "req.body.token",
      "res.headers['set-cookie']",
    ],
    censor: "[redacted]",
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" },
        },
      }),
});
