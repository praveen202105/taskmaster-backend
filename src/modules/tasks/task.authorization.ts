import { prisma } from "../../config/database.js";
import { TeamRole } from "../../generated/prisma/enums.js";
import { forbidden, notFound } from "../../shared/errors/app-error.js";
import { getTeamMembership } from "../teams/team.authorization.js";

export const getTaskForMember = async (taskId: string, userId: string) => {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { project: { select: { teamId: true } } },
  });
  if (!task) throw notFound("Task");
  const membership = await getTeamMembership(task.project.teamId, userId);
  return { task, membership };
};

export const canManageTask = (userId: string, creatorId: string, role: TeamRole) =>
  userId === creatorId || role === TeamRole.OWNER || role === TeamRole.ADMIN;

export const requireTaskManager = async (taskId: string, userId: string) => {
  const context = await getTaskForMember(taskId, userId);
  if (!canManageTask(userId, context.task.createdById, context.membership.role)) {
    throw forbidden("Only the task creator or a team manager can perform this action");
  }
  return context;
};

export const ensureTeamAssignee = async (teamId: string, assigneeId: string | null | undefined) => {
  if (!assigneeId) return;
  const membership = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId: assigneeId } },
  });
  if (!membership) throw forbidden("Assignee must be a current member of the task's team");
};
