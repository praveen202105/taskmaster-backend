import type { RequestHandler } from "express";
import type { ZodType } from "zod";

import { AppError } from "../errors/app-error.js";

interface RequestSchemas {
  body?: ZodType;
  params?: ZodType;
  query?: ZodType;
}

export const validate =
  (schemas: RequestSchemas): RequestHandler =>
  (request, _response, next) => {
    const details: { field?: string; message: string }[] = [];
    const sources: Array<["body" | "params" | "query", ZodType | undefined]> = [
      ["body", schemas.body],
      ["params", schemas.params],
      ["query", schemas.query],
    ];

    for (const [source, schema] of sources) {
      if (!schema) continue;
      const result = schema.safeParse(request[source]);
      if (result.success) {
        Object.defineProperty(request, source, {
          configurable: true,
          enumerable: true,
          value: result.data,
          writable: true,
        });
      } else {
        details.push(
          ...result.error.issues.map((issue) => ({
            field: [source, ...issue.path.map(String)].join("."),
            message: issue.message,
          })),
        );
      }
    }

    if (details.length > 0) {
      return next(new AppError(400, "VALIDATION_ERROR", "Request validation failed", details));
    }

    return next();
  };
