import { Router } from "express";
import { z } from "zod";

import { prisma } from "../../config/database.js";
import { TeamRole } from "../../generated/prisma/enums.js";
import { authenticatedUserId, requireAuth } from "../../shared/auth/auth.middleware.js";
import { forbidden, notFound } from "../../shared/errors/app-error.js";
import { paginationSchema } from "../../shared/http/schemas.js";
import { validate } from "../../shared/http/validate.js";
import { publicUserSelect } from "../../shared/serialization/user.js";
import { getTaskForMember } from "../tasks/task.authorization.js";
import { commentBodySchema } from "./comment.schemas.js";

const taskParams = z.object({ taskId: z.uuid() });
const commentParams = z.object({ commentId: z.uuid() });

export const commentRouter = Router();
commentRouter.use(requireAuth);

commentRouter.get(
  "/tasks/:taskId/comments",
  validate({ params: taskParams, query: paginationSchema }),
  async (request, response) => {
    const { taskId } = taskParams.parse(request.params);
    const query = paginationSchema.parse(request.query);
    await getTaskForMember(taskId, authenticatedUserId(request));
    const where = { taskId };
    const [comments, total] = await prisma.$transaction([
      prisma.comment.findMany({
        where,
        orderBy: { createdAt: "asc" },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: { author: { select: publicUserSelect } },
      }),
      prisma.comment.count({ where }),
    ]);
    response.status(200).json({
      data: comments,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    });
  },
);

commentRouter.post(
  "/tasks/:taskId/comments",
  validate({ params: taskParams, body: commentBodySchema }),
  async (request, response) => {
    const userId = authenticatedUserId(request);
    const { taskId } = taskParams.parse(request.params);
    await getTaskForMember(taskId, userId);
    const comment = await prisma.comment.create({
      data: { taskId, authorId: userId, ...commentBodySchema.parse(request.body) },
      include: { author: { select: publicUserSelect } },
    });
    response.status(201).json({ data: comment });
  },
);

commentRouter.patch(
  "/comments/:commentId",
  validate({ params: commentParams, body: commentBodySchema }),
  async (request, response) => {
    const userId = authenticatedUserId(request);
    const { commentId } = commentParams.parse(request.params);
    const existing = await prisma.comment.findUnique({ where: { id: commentId } });
    if (!existing) throw notFound("Comment");
    const { membership } = await getTaskForMember(existing.taskId, userId);
    if (
      existing.authorId !== userId &&
      membership.role !== TeamRole.OWNER &&
      membership.role !== TeamRole.ADMIN
    ) {
      throw forbidden("Only the comment author or a team manager can update this comment");
    }
    const comment = await prisma.comment.update({
      where: { id: commentId },
      data: commentBodySchema.parse(request.body),
      include: { author: { select: publicUserSelect } },
    });
    response.status(200).json({ data: comment });
  },
);

commentRouter.delete(
  "/comments/:commentId",
  validate({ params: commentParams }),
  async (request, response) => {
    const userId = authenticatedUserId(request);
    const { commentId } = commentParams.parse(request.params);
    const existing = await prisma.comment.findUnique({ where: { id: commentId } });
    if (!existing) throw notFound("Comment");
    const { membership } = await getTaskForMember(existing.taskId, userId);
    if (
      existing.authorId !== userId &&
      membership.role !== TeamRole.OWNER &&
      membership.role !== TeamRole.ADMIN
    ) {
      throw forbidden("Only the comment author or a team manager can delete this comment");
    }
    await prisma.comment.delete({ where: { id: commentId } });
    response.status(204).send();
  },
);
