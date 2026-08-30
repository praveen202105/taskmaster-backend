import { isUtf8 } from "node:buffer";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { access, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { Router } from "express";
import { fileTypeFromFile } from "file-type";
import multer from "multer";
import { z } from "zod";

import { prisma } from "../../config/database.js";
import { env } from "../../config/env.js";
import { TeamRole } from "../../generated/prisma/enums.js";
import { authenticatedUserId, requireAuth } from "../../shared/auth/auth.middleware.js";
import { AppError, badRequest, forbidden, notFound } from "../../shared/errors/app-error.js";
import { validate } from "../../shared/http/validate.js";
import { publicUserSelect } from "../../shared/serialization/user.js";
import { getTaskForMember } from "../tasks/task.authorization.js";
import { localFileStorage } from "./local-file.storage.js";

const taskParams = z.object({ taskId: z.uuid() });
const attachmentParams = z.object({ attachmentId: z.uuid() });
const temporaryDirectory = path.resolve(env.UPLOAD_DIR, ".tmp");
mkdirSync(temporaryDirectory, { recursive: true, mode: 0o700 });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_request, _file, callback) => {
      mkdirSync(temporaryDirectory, { recursive: true, mode: 0o700 });
      callback(null, temporaryDirectory);
    },
    filename: (_request, _file, callback) => callback(null, randomUUID()),
  }),
  limits: { files: 1, fileSize: env.MAX_ATTACHMENT_BYTES },
});

const attachmentSelect = {
  id: true,
  taskId: true,
  originalName: true,
  mimeType: true,
  size: true,
  createdAt: true,
  uploadedBy: { select: publicUserSelect },
} as const;

const inspectMimeType = async (temporaryPath: string, declaredMimeType: string) => {
  const declared = declaredMimeType.toLowerCase();
  if (!env.allowedAttachmentMimeTypes.has(declared)) {
    throw new AppError(415, "UNSUPPORTED_ATTACHMENT_TYPE", "Attachment type is not allowed");
  }
  const detected = await fileTypeFromFile(temporaryPath);
  if (detected) {
    if (detected.mime !== declared || !env.allowedAttachmentMimeTypes.has(detected.mime)) {
      throw new AppError(
        415,
        "ATTACHMENT_TYPE_MISMATCH",
        "Attachment content does not match its MIME type",
      );
    }
    return detected.mime;
  }
  if (declared === "text/plain" && isUtf8(await readFile(temporaryPath))) return declared;
  throw new AppError(
    415,
    "UNSUPPORTED_ATTACHMENT_TYPE",
    "Attachment content type could not be verified",
  );
};

export const attachmentRouter = Router();
attachmentRouter.use(requireAuth);

attachmentRouter.get(
  "/tasks/:taskId/attachments",
  validate({ params: taskParams }),
  async (request, response) => {
    const { taskId } = taskParams.parse(request.params);
    await getTaskForMember(taskId, authenticatedUserId(request));
    const attachments = await prisma.attachment.findMany({
      where: { taskId },
      orderBy: { createdAt: "asc" },
      select: attachmentSelect,
    });
    response.status(200).json({ data: attachments });
  },
);

attachmentRouter.post(
  "/tasks/:taskId/attachments",
  validate({ params: taskParams }),
  upload.single("file"),
  async (request, response) => {
    const userId = authenticatedUserId(request);
    const { taskId } = taskParams.parse(request.params);
    await getTaskForMember(taskId, userId);
    if (!request.file) throw badRequest("A multipart file field named 'file' is required");
    const originalName = path.basename(request.file.originalname).slice(0, 255);
    if (!originalName) throw badRequest("Attachment filename is required");

    let storageKey: string | undefined;
    try {
      const mimeType = await inspectMimeType(request.file.path, request.file.mimetype);
      storageKey = await localFileStorage.saveTemporaryFile(request.file.path);
      const attachment = await prisma.attachment.create({
        data: {
          taskId,
          uploadedById: userId,
          storageKey,
          originalName,
          mimeType,
          size: request.file.size,
        },
        select: attachmentSelect,
      });
      response.status(201).json({ data: attachment });
    } catch (error) {
      await rm(request.file.path, { force: true });
      if (storageKey) await localFileStorage.remove(storageKey);
      throw error;
    }
  },
);

attachmentRouter.get(
  "/attachments/:attachmentId/content",
  validate({ params: attachmentParams }),
  async (request, response) => {
    const { attachmentId } = attachmentParams.parse(request.params);
    const attachment = await prisma.attachment.findUnique({ where: { id: attachmentId } });
    if (!attachment) throw notFound("Attachment");
    await getTaskForMember(attachment.taskId, authenticatedUserId(request));
    const filePath = localFileStorage.pathFor(attachment.storageKey);
    try {
      await access(filePath);
    } catch {
      throw notFound("Attachment content");
    }
    response.type(attachment.mimeType);
    response.download(filePath, attachment.originalName);
  },
);

attachmentRouter.delete(
  "/attachments/:attachmentId",
  validate({ params: attachmentParams }),
  async (request, response) => {
    const userId = authenticatedUserId(request);
    const { attachmentId } = attachmentParams.parse(request.params);
    const attachment = await prisma.attachment.findUnique({ where: { id: attachmentId } });
    if (!attachment) throw notFound("Attachment");
    const { membership } = await getTaskForMember(attachment.taskId, userId);
    if (
      attachment.uploadedById !== userId &&
      membership.role !== TeamRole.OWNER &&
      membership.role !== TeamRole.ADMIN
    ) {
      throw forbidden("Only the uploader or a team manager can delete this attachment");
    }
    await prisma.attachment.delete({ where: { id: attachmentId } });
    await localFileStorage.remove(attachment.storageKey);
    response.status(204).send();
  },
);
