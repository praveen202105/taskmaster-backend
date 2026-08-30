import multer from "multer";
import type { ErrorRequestHandler, RequestHandler } from "express";

import { Prisma } from "../../generated/prisma/client.js";
import { logger } from "../../config/logger.js";
import { AppError } from "../errors/app-error.js";

export const notFoundHandler: RequestHandler = (request, _response, next) => {
  next(
    new AppError(404, "ROUTE_NOT_FOUND", `Route ${request.method} ${request.path} was not found`),
  );
};

export const errorHandler: ErrorRequestHandler = (error: unknown, request, response, _next) => {
  let normalizedError: AppError;

  if (error instanceof AppError) {
    normalizedError = error;
  } else if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    normalizedError = new AppError(
      413,
      "ATTACHMENT_TOO_LARGE",
      "Attachment exceeds the maximum size",
    );
  } else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    normalizedError = new AppError(409, "CONFLICT", "A resource with these values already exists");
  } else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
    normalizedError = new AppError(404, "NOT_FOUND", "The requested resource was not found");
  } else if (error instanceof SyntaxError && "body" in error) {
    normalizedError = new AppError(400, "INVALID_JSON", "Request body contains invalid JSON");
  } else {
    normalizedError = new AppError(
      500,
      "INTERNAL_ERROR",
      "An unexpected error occurred",
      undefined,
      false,
    );
  }

  if (normalizedError.statusCode >= 500) {
    request.log.error({ err: error }, "Unhandled request error");
  } else {
    logger.debug({ err: normalizedError, requestId: request.id }, "Request rejected");
  }

  response.status(normalizedError.statusCode).json({
    error: {
      code: normalizedError.code,
      message: normalizedError.expose ? normalizedError.message : "An unexpected error occurred",
      ...(normalizedError.details ? { details: normalizedError.details } : {}),
      requestId: request.id,
    },
  });
};
