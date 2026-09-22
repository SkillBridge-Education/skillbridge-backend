import { rateLimit } from "express-rate-limit";

const jsonHandler = (message: string) => (_req: unknown, res: {
  status: (code: number) => { json: (body: unknown) => void };
}) => {
  res.status(429).json({ message });
};

/**
 * Baseline limit for the whole API. Generous enough that a normal session never
 * notices it, low enough that a single client cannot saturate the server.
 */
export const globalRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: jsonHandler("Too many requests. Please slow down."),
});

/**
 * Public and unauthenticated, so it is the cheapest endpoint to abuse for
 * scraping the member directory.
 */
export const searchRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: jsonHandler("Too many searches. Please try again shortly."),
});

/**
 * Writes that create content other people receive. Spamming these is harassment,
 * not just load.
 */
export const contentRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: jsonHandler("You are sending messages too quickly."),
});

/**
 * Reports are deliberately slow: a report is a serious act, and rate limiting
 * them is one of the defences against coordinated mass-reporting.
 */
export const reportRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: jsonHandler("Too many reports submitted. Please try again later."),
});
