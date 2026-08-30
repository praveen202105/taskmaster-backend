import { createHash, randomBytes, randomUUID } from "node:crypto";

import { jwtVerify, SignJWT } from "jose";

import { env } from "../../config/env.js";
import { unauthorized } from "../errors/app-error.js";

const accessSecret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const issuer = "taskmaster-backend";
const audience = "taskmaster-api";

export const createAccessToken = (userId: string) =>
  new SignJWT({ type: "access" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setJti(randomUUID())
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(env.ACCESS_TOKEN_TTL)
    .sign(accessSecret);

export const verifyAccessToken = async (token: string) => {
  try {
    const { payload } = await jwtVerify(token, accessSecret, { issuer, audience });
    if (payload.type !== "access" || !payload.sub) throw unauthorized("Access token is invalid");
    return payload.sub;
  } catch (error) {
    if (error instanceof Error && error.name === "AppError") throw error;
    throw unauthorized("Access token is invalid or expired");
  }
};

export const createRefreshToken = () => randomBytes(48).toString("base64url");
export const hashRefreshToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const createTokenFamilyId = () => randomUUID();

export const refreshExpiryDate = () => {
  const expiresAt = new Date();
  expiresAt.setUTCDate(expiresAt.getUTCDate() + env.REFRESH_TOKEN_TTL_DAYS);
  return expiresAt;
};
