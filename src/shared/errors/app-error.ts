export interface ErrorDetail {
  field?: string;
  message: string;
}

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: ErrorDetail[] | undefined;
  readonly expose: boolean;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: ErrorDetail[],
    expose = true,
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.expose = expose;
  }
}

export const badRequest = (message: string, details?: ErrorDetail[]) =>
  new AppError(400, "BAD_REQUEST", message, details);

export const unauthorized = (message = "Authentication is required") =>
  new AppError(401, "UNAUTHORIZED", message);

export const forbidden = (message = "You do not have permission to perform this action") =>
  new AppError(403, "FORBIDDEN", message);

export const notFound = (resource: string) =>
  new AppError(404, "NOT_FOUND", `${resource} was not found`);

export const conflict = (message: string) => new AppError(409, "CONFLICT", message);
