import { Router } from "express";

import { env } from "../../config/env.js";
import { authRateLimit } from "../../shared/http/rate-limit.js";
import { validate } from "../../shared/http/validate.js";
import {
  clearRefreshCookie,
  login,
  logout,
  refresh,
  register,
  setRefreshCookie,
} from "./auth.service.js";
import { loginSchema, registerSchema } from "./auth.schemas.js";

export const authRouter = Router();

if (env.NODE_ENV !== "test") authRouter.use(authRateLimit);

const refreshCookieFrom = (request: { cookies: unknown }) => {
  if (!request.cookies || typeof request.cookies !== "object") return undefined;
  const value = (request.cookies as Record<string, unknown>)[env.REFRESH_COOKIE_NAME];
  return typeof value === "string" ? value : undefined;
};

authRouter.post("/register", validate({ body: registerSchema }), async (request, response) => {
  const result = await register(registerSchema.parse(request.body), request);
  setRefreshCookie(response, result.refreshToken);
  response.status(201).json({ data: { user: result.user, accessToken: result.accessToken } });
});

authRouter.post("/login", validate({ body: loginSchema }), async (request, response) => {
  const result = await login(loginSchema.parse(request.body), request);
  setRefreshCookie(response, result.refreshToken);
  response.status(200).json({ data: { user: result.user, accessToken: result.accessToken } });
});

authRouter.post("/refresh", async (request, response) => {
  const result = await refresh(refreshCookieFrom(request), request);
  setRefreshCookie(response, result.refreshToken);
  response.status(200).json({ data: { user: result.user, accessToken: result.accessToken } });
});

authRouter.post("/logout", async (request, response) => {
  await logout(refreshCookieFrom(request));
  clearRefreshCookie(response);
  response.status(204).send();
});
