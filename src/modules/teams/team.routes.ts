import { Router } from "express";
import { z } from "zod";

import { prisma } from "../../config/database.js";
import { TeamRole } from "../../generated/prisma/enums.js";
import { authenticatedUserId, requireAuth } from "../../shared/auth/auth.middleware.js";
import { conflict, forbidden, notFound } from "../../shared/errors/app-error.js";
import { idParamsSchema } from "../../shared/http/schemas.js";
import { validate } from "../../shared/http/validate.js";
import { publicUserSelect } from "../../shared/serialization/user.js";
import { removeAttachmentFiles } from "../attachments/attachment.cleanup.js";
import { createInvitationSchema, createTeamSchema, updateTeamSchema } from "./team.schemas.js";
import { getTeamMembership, requireTeamManager, requireTeamOwner } from "./team.authorization.js";

const teamParams = idParamsSchema("teamId");
const memberParams = teamParams.extend({ userId: z.uuid() });
const invitationParams = teamParams.extend({ invitationId: z.uuid() });

export const teamRouter = Router();
teamRouter.use(requireAuth);

const teamInclude = {
  _count: { select: { members: true, projects: true } },
  owner: { select: publicUserSelect },
} as const;

teamRouter.post("/", validate({ body: createTeamSchema }), async (request, response) => {
  const userId = authenticatedUserId(request);
  const body = createTeamSchema.parse(request.body);
  const team = await prisma.$transaction(async (transaction) => {
    const created = await transaction.team.create({ data: { ...body, ownerId: userId } });
    await transaction.teamMember.create({
      data: { teamId: created.id, userId, role: TeamRole.OWNER },
    });
    return transaction.team.findUniqueOrThrow({ where: { id: created.id }, include: teamInclude });
  });
  response.status(201).json({ data: team });
});

teamRouter.get("/", async (request, response) => {
  const memberships = await prisma.teamMember.findMany({
    where: { userId: authenticatedUserId(request) },
    orderBy: { joinedAt: "asc" },
    include: { team: { include: teamInclude } },
  });
  response.status(200).json({
    data: memberships.map(({ role, joinedAt, team }) => ({
      ...team,
      membership: { role, joinedAt },
    })),
  });
});

teamRouter.get("/:teamId", validate({ params: teamParams }), async (request, response) => {
  const { teamId } = teamParams.parse(request.params);
  const membership = await getTeamMembership(teamId, authenticatedUserId(request));
  const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId }, include: teamInclude });
  response.status(200).json({ data: { ...team, membership: { role: membership.role } } });
});

teamRouter.patch(
  "/:teamId",
  validate({ params: teamParams, body: updateTeamSchema }),
  async (request, response) => {
    const { teamId } = teamParams.parse(request.params);
    await requireTeamManager(teamId, authenticatedUserId(request));
    const team = await prisma.team.update({
      where: { id: teamId },
      data: updateTeamSchema.parse(request.body),
      include: teamInclude,
    });
    response.status(200).json({ data: team });
  },
);

teamRouter.delete("/:teamId", validate({ params: teamParams }), async (request, response) => {
  const { teamId } = teamParams.parse(request.params);
  await requireTeamOwner(teamId, authenticatedUserId(request));
  const attachments = await prisma.attachment.findMany({
    where: { task: { project: { teamId } } },
    select: { storageKey: true },
  });
  await prisma.team.delete({ where: { id: teamId } });
  await removeAttachmentFiles(attachments.map(({ storageKey }) => storageKey));
  response.status(204).send();
});

teamRouter.get("/:teamId/members", validate({ params: teamParams }), async (request, response) => {
  const { teamId } = teamParams.parse(request.params);
  await getTeamMembership(teamId, authenticatedUserId(request));
  const members = await prisma.teamMember.findMany({
    where: { teamId },
    orderBy: { joinedAt: "asc" },
    include: { user: { select: publicUserSelect } },
  });
  response.status(200).json({ data: members });
});

teamRouter.delete(
  "/:teamId/members/:userId",
  validate({ params: memberParams }),
  async (request, response) => {
    const { teamId, userId: targetUserId } = memberParams.parse(request.params);
    const actorId = authenticatedUserId(request);
    const actor = await getTeamMembership(teamId, actorId);
    const target = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId: targetUserId } },
    });
    if (!target) throw notFound("Team member");
    if (target.role === TeamRole.OWNER) throw forbidden("The team owner cannot be removed");
    const removingSelf = actorId === targetUserId;
    if (!removingSelf && actor.role !== TeamRole.OWNER && actor.role !== TeamRole.ADMIN) {
      throw forbidden();
    }
    if (actor.role === TeamRole.ADMIN && target.role === TeamRole.ADMIN && !removingSelf) {
      throw forbidden("Administrators cannot remove other administrators");
    }
    await prisma.$transaction([
      prisma.task.updateMany({
        where: { assigneeId: targetUserId, project: { teamId } },
        data: { assigneeId: null },
      }),
      prisma.teamMember.delete({ where: { teamId_userId: { teamId, userId: targetUserId } } }),
    ]);
    response.status(204).send();
  },
);

teamRouter.post(
  "/:teamId/invitations",
  validate({ params: teamParams, body: createInvitationSchema }),
  async (request, response) => {
    const { teamId } = teamParams.parse(request.params);
    const actorId = authenticatedUserId(request);
    const actor = await requireTeamManager(teamId, actorId);
    const body = createInvitationSchema.parse(request.body);
    if (body.role === TeamRole.ADMIN && actor.role !== TeamRole.OWNER) {
      throw forbidden("Only the team owner can invite an administrator");
    }
    const existingMember = await prisma.teamMember.findFirst({
      where: { teamId, user: { email: body.email } },
    });
    if (existingMember) throw conflict("This user is already a team member");
    await prisma.teamInvitation.updateMany({
      where: { teamId, email: body.email, status: "PENDING", expiresAt: { lte: new Date() } },
      data: { status: "EXPIRED" },
    });
    const pending = await prisma.teamInvitation.findFirst({
      where: { teamId, email: body.email, status: "PENDING", expiresAt: { gt: new Date() } },
    });
    if (pending) throw conflict("A pending invitation already exists for this email");
    const expiresAt = new Date();
    expiresAt.setUTCDate(expiresAt.getUTCDate() + 7);
    const invitation = await prisma.teamInvitation.create({
      data: { teamId, invitedById: actorId, expiresAt, ...body },
      include: { team: true, invitedBy: { select: publicUserSelect } },
    });
    response.status(201).json({ data: invitation });
  },
);

teamRouter.delete(
  "/:teamId/invitations/:invitationId",
  validate({ params: invitationParams }),
  async (request, response) => {
    const { teamId, invitationId } = invitationParams.parse(request.params);
    await requireTeamManager(teamId, authenticatedUserId(request));
    const result = await prisma.teamInvitation.updateMany({
      where: { id: invitationId, teamId, status: "PENDING" },
      data: { status: "REVOKED" },
    });
    if (result.count === 0) throw notFound("Pending invitation");
    response.status(204).send();
  },
);
