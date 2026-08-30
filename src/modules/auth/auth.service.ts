import { randomUUID } from "node:crypto";

import type { Request, Response } from "express";

import { prisma } from "../../config/database.js";
import { env } from "../../config/env.js";
import { conflict, unauthorized } from "../../shared/errors/app-error.js";
import { hashPassword, verifyPassword } from "../../shared/auth/password.js";
import {
  createAccessToken,
  createRefreshToken,
  createTokenFamilyId,
  hashRefreshToken,
  refreshExpiryDate,
} from "../../shared/auth/tokens.js";
import { publicUserSelect } from "../../shared/serialization/user.js";

interface SessionContext {
  ipAddress?: string;
  userAgent?: string;
}

const sessionContext = (request: Request): SessionContext => {
  const userAgent = request.get("user-agent");
  return {
    ...(request.ip ? { ipAddress: request.ip } : {}),
    ...(userAgent ? { userAgent } : {}),
  };
};

const issueSession = async (
  userId: string,
  context: SessionContext,
  familyId = createTokenFamilyId(),
) => {
  const rawToken = createRefreshToken();
  const sessionId = randomUUID();
  await prisma.refreshSession.create({
    data: {
      id: sessionId,
      userId,
      familyId,
      tokenHash: hashRefreshToken(rawToken),
      expiresAt: refreshExpiryDate(),
      ...context,
    },
  });
  return { rawToken, sessionId, familyId };
};

export const setRefreshCookie = (response: Response, token: string) => {
  response.cookie(env.REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/v1/auth",
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
};

export const clearRefreshCookie = (response: Response) => {
  response.clearCookie(env.REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/v1/auth",
  });
};

export const register = async (
  input: { email: string; name: string; password: string },
  request: Request,
) => {
  const existingUser = await prisma.user.findUnique({ where: { email: input.email } });
  if (existingUser) throw conflict("An account with this email already exists");

  const user = await prisma.user.create({
    data: {
      email: input.email,
      name: input.name,
      passwordHash: await hashPassword(input.password),
    },
    select: publicUserSelect,
  });
  const session = await issueSession(user.id, sessionContext(request));
  return { user, accessToken: await createAccessToken(user.id), refreshToken: session.rawToken };
};

export const login = async (input: { email: string; password: string }, request: Request) => {
  const userWithPassword = await prisma.user.findUnique({ where: { email: input.email } });
  if (!userWithPassword || !(await verifyPassword(userWithPassword.passwordHash, input.password))) {
    throw unauthorized("Email or password is incorrect");
  }

  const session = await issueSession(userWithPassword.id, sessionContext(request));
  const user = {
    id: userWithPassword.id,
    email: userWithPassword.email,
    name: userWithPassword.name,
    avatarUrl: userWithPassword.avatarUrl,
    createdAt: userWithPassword.createdAt,
    updatedAt: userWithPassword.updatedAt,
  };
  return { user, accessToken: await createAccessToken(user.id), refreshToken: session.rawToken };
};

export const refresh = async (rawToken: string | undefined, request: Request) => {
  if (!rawToken) throw unauthorized("Refresh token is missing");
  const tokenHash = hashRefreshToken(rawToken);
  const current = await prisma.refreshSession.findUnique({
    where: { tokenHash },
    include: { user: { select: publicUserSelect } },
  });

  if (!current) throw unauthorized("Refresh token is invalid");
  if (current.revokedAt) {
    await prisma.refreshSession.updateMany({
      where: { familyId: current.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw unauthorized("Refresh token reuse was detected; the session has been revoked");
  }
  if (current.expiresAt <= new Date()) throw unauthorized("Refresh token has expired");

  const nextToken = createRefreshToken();
  const nextSessionId = randomUUID();
  await prisma.$transaction([
    prisma.refreshSession.update({
      where: { id: current.id },
      data: { revokedAt: new Date(), replacedBy: nextSessionId },
    }),
    prisma.refreshSession.create({
      data: {
        id: nextSessionId,
        userId: current.userId,
        familyId: current.familyId,
        tokenHash: hashRefreshToken(nextToken),
        expiresAt: refreshExpiryDate(),
        ...sessionContext(request),
      },
    }),
  ]);

  return {
    user: current.user,
    accessToken: await createAccessToken(current.userId),
    refreshToken: nextToken,
  };
};

export const logout = async (rawToken: string | undefined) => {
  if (!rawToken) return;
  await prisma.refreshSession.updateMany({
    where: { tokenHash: hashRefreshToken(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
};
