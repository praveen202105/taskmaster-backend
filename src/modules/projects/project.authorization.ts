import { prisma } from "../../config/database.js";
import { notFound } from "../../shared/errors/app-error.js";
import { getTeamMembership, requireTeamManager } from "../teams/team.authorization.js";

export const getProjectForMember = async (projectId: string, userId: string) => {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw notFound("Project");
  await getTeamMembership(project.teamId, userId);
  return project;
};

export const getProjectForManager = async (projectId: string, userId: string) => {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw notFound("Project");
  await requireTeamManager(project.teamId, userId);
  return project;
};
