import { randomUUID } from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";

import { env } from "../../config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { FileStorage } from "./file-storage.js";

export class LocalFileStorage implements FileStorage {
  readonly rootDirectory: string;

  constructor(rootDirectory: string) {
    this.rootDirectory = path.resolve(rootDirectory);
  }

  async saveTemporaryFile(temporaryPath: string) {
    await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
    const storageKey = randomUUID();
    await rename(temporaryPath, this.pathFor(storageKey));
    return storageKey;
  }

  pathFor(storageKey: string) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(storageKey)
    ) {
      throw new AppError(400, "INVALID_STORAGE_KEY", "Attachment storage key is invalid");
    }
    const filePath = path.resolve(this.rootDirectory, storageKey);
    if (path.dirname(filePath) !== this.rootDirectory) {
      throw new AppError(400, "INVALID_STORAGE_KEY", "Attachment storage key is invalid");
    }
    return filePath;
  }

  async remove(storageKey: string) {
    await rm(this.pathFor(storageKey), { force: true });
  }
}

export const localFileStorage = new LocalFileStorage(env.UPLOAD_DIR);
