import { Router } from "express";
import { z } from "zod";

import { prisma } from "../../config/database.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { TaskStatus } from "../../generated/prisma/enums.js";
import { authenticatedUserId, requireAuth } from "../../shared/auth/auth.middleware.js";
import { forbidden } from "../../shared/errors/app-error.js";
import { validate } from "../../shared/http/validate.js";
import { publicUserSelect } from "../../shared/serialization/user.js";
import { removeAttachmentFiles } from "../attachments/attachment.cleanup.js";
import { getProjectForMember } from "../projects/project.authorization.js";
import {
  canManageTask,
  ensureTeamAssignee,
  getTaskForMember,
  requireTaskManager,
} from "./task.authorization.js";
import { createTaskSchema, taskListQuerySchema, updateTaskSchema } from "./task.schemas.js";

const projectParams = z.object({ projectId: z.uuid() });
const taskParams = z.object({ taskId: z.uuid() });

const taskInclude = {
  assignee: { select: publicUserSelect },
  createdBy: { select: publicUserSelect },
  project: { select: { id: true, name: true, teamId: true } },
  _count: { select: { comments: true, attachments: true } },
} as const;

export const taskRouter = Router();
taskRouter.use(requireAuth);

taskRouter.post(
  "/projects/:projectId/tasks",
  validate({ params: projectParams, body: createTaskSchema }),
  async (request, response) => {
    const userId = authenticatedUserId(request);
    const { projectId } = projectParams.parse(request.params);
    const body = createTaskSchema.parse(request.body);
    const project = await getProjectForMember(projectId, userId);
    await ensureTeamAssignee(project.teamId, body.assigneeId);
    const task = await prisma.task.create({
      data: { projectId, createdById: userId, ...body },
      include: taskInclude,
    });
    response.status(201).json({ data: task });
  },
);

taskRouter.get("/tasks", validate({ query: taskListQuerySchema }), async (request, response) => {
  const userId = authenticatedUserId(request);
  const query = taskListQuerySchema.parse(request.query);
  if (query.projectId) await getProjectForMember(query.projectId, userId);
  const where: Prisma.TaskWhereInput = {
    project: {
      ...(query.projectId ? { id: query.projectId } : {}),
      team: { members: { some: { userId } } },
    },
    ...(query.status ? { status: query.status } : {}),
    ...(query.priority ? { priority: query.priority } : {}),
    ...(query.assignee === "me" ? { assigneeId: userId } : {}),
    ...(query.q
      ? {
          OR: [
            { title: { contains: query.q, mode: "insensitive" } },
            { description: { contains: query.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [tasks, total] = await prisma.$transaction([
    prisma.task.findMany({
      where,
      orderBy: { [query.sortBy]: query.order },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: taskInclude,
    }),
    prisma.task.count({ where }),
  ]);
  response.status(200).json({
    data: tasks,
    meta: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  });
});

taskRouter.get("/tasks/:taskId", validate({ params: taskParams }), async (request, response) => {
  const { taskId } = taskParams.parse(request.params);
  await getTaskForMember(taskId, authenticatedUserId(request));
  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, include: taskInclude });
  response.status(200).json({ data: task });
});

taskRouter.patch(
  "/tasks/:taskId",
  validate({ params: taskParams, body: updateTaskSchema }),
  async (request, response) => {
    const userId = authenticatedUserId(request);
    const { taskId } = taskParams.parse(request.params);
    const body = updateTaskSchema.parse(request.body);
    const { task, membership } = await getTaskForMember(taskId, userId);
    const onlyStatus = Object.keys(body).every((key) => key === "status");
    const manager = canManageTask(userId, task.createdById, membership.role);
    if (!manager && !(onlyStatus && task.assigneeId === userId)) {
      throw forbidden("Only the task creator, assignee, or a team manager can update this task");
    }
    await ensureTeamAssignee(task.project.teamId, body.assigneeId);
    const taskUpdate = await prisma.task.update({
      where: { id: taskId },
      data: {
        ...body,
        ...(body.status
          ? { completedAt: body.status === TaskStatus.COMPLETED ? new Date() : null }
          : {}),
      },
      include: taskInclude,
    });
    response.status(200).json({ data: taskUpdate });
  },
);

taskRouter.delete("/tasks/:taskId", validate({ params: taskParams }), async (request, response) => {
  const { taskId } = taskParams.parse(request.params);
  await requireTaskManager(taskId, authenticatedUserId(request));
  const attachments = await prisma.attachment.findMany({
    where: { taskId },
    select: { storageKey: true },
  });
  await prisma.task.delete({ where: { id: taskId } });
  await removeAttachmentFiles(attachments.map(({ storageKey }) => storageKey));
  response.status(204).send();
});
