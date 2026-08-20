import { NextFunction, Request, Response } from "express";
import { HttpError } from "../utils/httpError";
import { logger } from "../utils/logger";
import { captureError } from "../utils/errorTracking";

export const errorMiddleware = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  // Log the full error for developers, but send clients a generic message.
  // Expected 4xx errors are noise at error level, so they log as warnings.
  const isExpected = err instanceof HttpError && err.statusCode < 500;

  logger[isExpected ? "warn" : "error"](
    { err, method: req.method, url: req.originalUrl },
    "Request failed"
  );

  // Only unexpected failures are worth an alert; a 400 is the API working.
  if (!isExpected) {
    captureError(err, { method: req.method, url: req.originalUrl });
  }

  if (err instanceof HttpError) {
    res.status(err.statusCode).json({
      message: err.message,
      ...err.details,
    });
    return;
  }

  if (
    err.message === "Email is already registered" ||
    err.message === "Invalid email or password"
  ) {
    const statusCode = err.message === "Email is already registered" ? 409 : 401;

    res.status(statusCode).json({
      message: err.message
    });
    return;
  }

  res.status(500).json({
    message: "Internal server error"
  });
};
