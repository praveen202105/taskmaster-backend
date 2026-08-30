import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loginSchema, registerSchema } from "../../src/modules/auth/auth.schemas.js";
import { LocalFileStorage } from "../../src/modules/attachments/local-file.storage.js";
import { createTaskSchema, taskListQuerySchema } from "../../src/modules/tasks/task.schemas.js";
import { hashPassword, verifyPassword } from "../../src/shared/auth/password.js";
import {
  createAccessToken,
  hashRefreshToken,
  verifyAccessToken,
} from "../../src/shared/auth/tokens.js";

describe("security primitives", () => {
  it("hashes and verifies passwords using Argon2id", async () => {
    const passwordHash = await hashPassword("A-strong-test-password!");
    expect(passwordHash).toContain("$argon2id$");
    await expect(verifyPassword(passwordHash, "A-strong-test-password!")).resolves.toBe(true);
    await expect(verifyPassword(passwordHash, "wrong-password")).resolves.toBe(false);
  });

  it("signs access tokens and rejects tampered tokens", async () => {
    const userId = "1e79b3df-34ea-4f7e-9d09-b8ea8d70c2ea";
    const token = await createAccessToken(userId);
    await expect(verifyAccessToken(token)).resolves.toBe(userId);
    await expect(verifyAccessToken(`${token}tampered`)).rejects.toMatchObject({ statusCode: 401 });
    expect(hashRefreshToken("token")).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("validation schemas", () => {
  it("normalizes registration and login emails", () => {
    expect(
      registerSchema.parse({
        name: "Praveen Gupta",
        email: "  USER@Example.COM ",
        password: "A-strong-test-password!",
      }).email,
    ).toBe("user@example.com");
    expect(loginSchema.parse({ email: "USER@Example.COM", password: "secret" }).email).toBe(
      "user@example.com",
    );
  });

  it("applies task defaults and validates task list query parameters", () => {
    const task = createTaskSchema.parse({
      title: "Ship API",
      description: "Complete production readiness",
      dueDate: "2026-09-01T10:00:00+05:30",
    });
    expect(task.priority).toBe("MEDIUM");
    expect(task.dueDate).toBeInstanceOf(Date);
    expect(taskListQuerySchema.parse({ page: "2", limit: "10" })).toMatchObject({
      page: 2,
      limit: 10,
      sortBy: "createdAt",
      order: "desc",
    });
  });
});

describe("local attachment storage", () => {
  it("stores files under randomized keys and rejects traversal", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "taskmaster-storage-"));
    const temporaryFile = path.join(root, "incoming");
    await writeFile(temporaryFile, "attachment evidence", "utf8");
    const storage = new LocalFileStorage(path.join(root, "private"));

    const storageKey = await storage.saveTemporaryFile(temporaryFile);
    expect(storageKey).toMatch(/^[0-9a-f-]{36}$/);
    await expect(readFile(storage.pathFor(storageKey), "utf8")).resolves.toBe(
      "attachment evidence",
    );
    expect(() => storage.pathFor("../outside")).toThrow("storage key is invalid");

    await storage.remove(storageKey);
    await expect(readFile(storage.pathFor(storageKey))).rejects.toMatchObject({ code: "ENOENT" });
    await rm(root, { recursive: true, force: true });
  });
});
