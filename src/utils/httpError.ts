export class HttpError extends Error {
  statusCode: number;

  /**
   * Extra fields merged into the JSON response alongside `message`.
   *
   * Used where the client has to act on more than a sentence — a suspension
   * carries its reason and the path to appeal, which the DSA requires us to
   * state rather than hide behind a generic error.
   */
  details?: Record<string, unknown>;

  constructor(statusCode: number, message: string, details?: Record<string, unknown>) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}
