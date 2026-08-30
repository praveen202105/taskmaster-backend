import { z } from "zod";

import { TaskPriority, TaskStatus } from "../../generated/prisma/enums.js";
import { paginationSchema } from "../../shared/http/schemas.js";

const dueDateSchema = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

export const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
  dueDate: dueDateSchema,
  priority: z.enum(TaskPriority).default(TaskPriority.MEDIUM),
  assigneeId: z.uuid().nullable().optional(),
});

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().min(1).max(5000).optional(),
    dueDate: dueDateSchema.optional(),
    priority: z.enum(TaskPriority).optional(),
    status: z.enum(TaskStatus).optional(),
    assigneeId: z.uuid().nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, "At least one field is required");

export const taskListQuerySchema = paginationSchema.extend({
  projectId: z.uuid().optional(),
  status: z.enum(TaskStatus).optional(),
  priority: z.enum(TaskPriority).optional(),
  assignee: z.literal("me").optional(),
  q: z.string().trim().min(1).max(200).optional(),
  sortBy: z
    .enum(["createdAt", "updatedAt", "dueDate", "title", "priority", "status"])
    .default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});
