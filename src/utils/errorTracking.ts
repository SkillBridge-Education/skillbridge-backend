import * as Sentry from "@sentry/node";
import { env } from "./env";
import { logger } from "./logger";

/**
 * Error tracking is entirely opt-in: with no SENTRY_DSN configured every call
 * here is a no-op, so the application runs identically with or without an
 * account. Set SENTRY_DSN to switch it on — no code change required.
 */
export const initErrorTracking = (): void => {
  if (!env.sentryDsn) {
    logger.debug("SENTRY_DSN not set, error tracking disabled");
    return;
  }

  Sentry.init({
    dsn: env.sentryDsn,
    environment: env.nodeEnv,
    // Sampled rather than full-rate: performance traces are the expensive part
    // of the quota and 10% is enough to spot a regression.
    tracesSampleRate: env.nodeEnv === "production" ? 0.1 : 1.0,
    // The users here are minors, so nothing identifying is attached by default.
    sendDefaultPii: false,
    beforeSend(event) {
      // Belt and braces: strip anything that could carry a credential even if a
      // future integration starts attaching request data.
      if (event.request?.headers) {
        delete event.request.headers.authorization;
        delete event.request.headers.cookie;
      }
      if (event.request?.data) {
        delete event.request.data;
      }
      return event;
    },
  });

  logger.info({ environment: env.nodeEnv }, "Error tracking enabled");
};

/**
 * Reports an error when tracking is configured, and is a no-op otherwise.
 * Callers should still log: this is for alerting, not for the audit trail.
 */
export const captureError = (error: unknown, context?: Record<string, unknown>): void => {
  if (!env.sentryDsn) return;

  Sentry.captureException(error, context ? { extra: context } : undefined);
};
