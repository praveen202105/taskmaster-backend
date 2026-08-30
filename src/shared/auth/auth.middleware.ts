import type { RequestHandler } from "express";

import { unauthorized } from "../errors/app-error.js";
import { verifyAccessToken } from "./tokens.js";

export const requireAuth: RequestHandler = async (request, _response, next) => {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return next(unauthorized());

  const token = authorization.slice("Bearer ".length).trim();
  if (!token) return next(unauthorized());

  try {
    request.auth = { userId: await verifyAccessToken(token) };
    return next();
  } catch (error) {
    return next(error);
  }
};

export const authenticatedUserId = (request: Express.Request) => {
  if (!request.auth) throw unauthorized();
  return request.auth.userId;
};
