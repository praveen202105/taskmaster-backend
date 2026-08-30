import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import multer from "multer";
import { describe, expect, it, vi } from "vitest";

import { Prisma } from "../../src/generated/prisma/client.js";
import { loginSchema, registerSchema } from "../../src/modules/auth/auth.schemas.js";
import { LocalFileStorage } from "../../src/modules/attachments/local-file.storage.js";
import { createTaskSchema, taskListQuerySchema } from "../../src/modules/tasks/task.schemas.js";
import { authenticatedUserId, requireAuth } from "../../src/shared/auth/auth.middleware.js";
import { hashPassword, verifyPassword } from "../../src/shared/auth/password.js";
import {
  createAccessToken,
  hashRefreshToken,
  verifyAccessToken,
} from "../../src/shared/auth/tokens.js";
import { errorHandler } from "../../src/shared/http/error-handler.js";

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

describe("HTTP security and error handling", () => {
  it("rejects an empty bearer token and an unauthenticated request context", async () => {
    const next = vi.fn();
    await requireAuth({ headers: { authorization: "Bearer " } } as never, {} as never, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    expect(() => authenticatedUserId({} as Express.Request)).toThrow("Authentication is required");
  });

  it.each([
    [new multer.MulterError("LIMIT_FILE_SIZE"), 413, "ATTACHMENT_TOO_LARGE"],
    [new multer.MulterError("LIMIT_UNEXPECTED_FILE"), 400, "UPLOAD_ERROR"],
    [
      new Prisma.PrismaClientKnownRequestError("duplicate", {
        code: "P2002",
        clientVersion: "test",
      }),
      409,
      "CONFLICT",
    ],
    [
      new Prisma.PrismaClientKnownRequestError("missing", {
        code: "P2025",
        clientVersion: "test",
      }),
      404,
      "NOT_FOUND",
    ],
    [new Error("database credentials must stay private"), 500, "INTERNAL_ERROR"],
  ])("normalizes %s without leaking implementation details", (error, status, code) => {
    const response = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    const request = { id: "request-id", log: { error: vi.fn() } };

    errorHandler(error, request as never, response as never, vi.fn());

    expect(response.status).toHaveBeenCalledWith(status);
    expect(response.json).toHaveBeenCalledWith({
      error: expect.objectContaining({ code, requestId: "request-id" }),
    });
    if (status === 500) {
      expect(JSON.stringify(response.json.mock.calls[0]![0])).not.toContain("database credentials");
      expect(request.log.error).toHaveBeenCalledOnce();
    }
  });
});
