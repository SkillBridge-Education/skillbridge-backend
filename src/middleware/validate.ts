import { NextFunction, Request, Response } from "express";
import { ZodError, ZodType } from "zod";

interface ValidationSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

const formatIssues = (error: ZodError): Array<{ path: string; message: string }> =>
  error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));

/**
 * Validates and replaces req.body/query/params with the parsed result, so
 * handlers receive data that is already typed, trimmed and stripped of unknown
 * keys. Rejecting unknown keys is what stops a client from smuggling fields
 * like `role` or `credits` into an update payload.
 */
export const validate =
  (schemas: ValidationSchemas) =>
  (req: Request, res: Response, next: NextFunction): void => {
    try {
      if (schemas.params) {
        req.params = schemas.params.parse(req.params) as typeof req.params;
      }
      if (schemas.query) {
        // Express 5 exposes req.query through a getter, so it cannot be reassigned.
        const parsed = schemas.query.parse(req.query);
        Object.defineProperty(req, "query", {
          value: parsed,
          configurable: true,
          enumerable: true,
          writable: false,
        });
      }
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          message: "Validation failed",
          errors: formatIssues(error),
        });
        return;
      }
      next(error);
    }
  };
