import { Router } from "express";
import { z } from "zod";

import { prisma } from "../../config/database.js";
import { authenticatedUserId, requireAuth } from "../../shared/auth/auth.middleware.js";
import { idParamsSchema } from "../../shared/http/schemas.js";
import { validate } from "../../shared/http/validate.js";
import { createProjectSchema, updateProjectSchema } from "./project.schemas.js";
import { getProjectForManager, getProjectForMember } from "./project.authorization.js";
import { getTeamMembership, requireTeamManager } from "../teams/team.authorization.js";

const teamParams = idParamsSchema("teamId");
const projectParams = z.object({ projectId: z.uuid() });

export const projectRouter = Router();
projectRouter.use(requireAuth);

projectRouter.get(
  "/teams/:teamId/projects",
  validate({ params: teamParams }),
  async (request, response) => {
    const { teamId } = teamParams.parse(request.params);
    await getTeamMembership(teamId, authenticatedUserId(request));
    const projects = await prisma.project.findMany({
      where: { teamId },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { tasks: true } } },
    });
    response.status(200).json({ data: projects });
  },
);

projectRouter.post(
  "/teams/:teamId/projects",
  validate({ params: teamParams, body: createProjectSchema }),
  async (request, response) => {
    const { teamId } = teamParams.parse(request.params);
    const userId = authenticatedUserId(request);
    await requireTeamManager(teamId, userId);
    const project = await prisma.project.create({
      data: { teamId, createdById: userId, ...createProjectSchema.parse(request.body) },
    });
    response.status(201).json({ data: project });
  },
);

projectRouter.get(
  "/projects/:projectId",
  validate({ params: projectParams }),
  async (request, response) => {
    const { projectId } = projectParams.parse(request.params);
    await getProjectForMember(projectId, authenticatedUserId(request));
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      include: { _count: { select: { tasks: true } } },
    });
    response.status(200).json({ data: project });
  },
);

projectRouter.patch(
  "/projects/:projectId",
  validate({ params: projectParams, body: updateProjectSchema }),
  async (request, response) => {
    const { projectId } = projectParams.parse(request.params);
    await getProjectForManager(projectId, authenticatedUserId(request));
    const project = await prisma.project.update({
      where: { id: projectId },
      data: updateProjectSchema.parse(request.body),
    });
    response.status(200).json({ data: project });
  },
);

projectRouter.delete(
  "/projects/:projectId",
  validate({ params: projectParams }),
  async (request, response) => {
    const { projectId } = projectParams.parse(request.params);
    await getProjectForManager(projectId, authenticatedUserId(request));
    await prisma.project.delete({ where: { id: projectId } });
    response.status(204).send();
  },
);
