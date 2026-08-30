import { Algorithm, hash, verify, Version } from "@node-rs/argon2";

const passwordHashOptions = {
  algorithm: Algorithm.Argon2id,
  version: Version.V0x13,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
  outputLen: 32,
} as const;

export const hashPassword = (password: string) => hash(password, passwordHashOptions);

export const verifyPassword = (passwordHash: string, password: string) =>
  verify(passwordHash, password);
