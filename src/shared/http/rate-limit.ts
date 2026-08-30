import { rateLimit } from "express-rate-limit";

import { env } from "../../config/env.js";

const baseOptions = {
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  standardHeaders: "draft-8" as const,
  legacyHeaders: false,
  handler: (
    _request: unknown,
    response: { status: (code: number) => { json: (body: unknown) => void } },
  ) => {
    response.status(429).json({
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests; please try again later",
      },
    });
  },
};

export const apiRateLimit = rateLimit({ ...baseOptions, limit: env.RATE_LIMIT_MAX });
export const authRateLimit = rateLimit({ ...baseOptions, limit: env.AUTH_RATE_LIMIT_MAX });
