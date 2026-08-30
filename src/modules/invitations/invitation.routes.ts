import { Router } from "express";
import { z } from "zod";

import { prisma } from "../../config/database.js";
import { authenticatedUserId, requireAuth } from "../../shared/auth/auth.middleware.js";
import { conflict, notFound } from "../../shared/errors/app-error.js";
import { validate } from "../../shared/http/validate.js";
import { publicUserSelect } from "../../shared/serialization/user.js";

const invitationParams = z.object({ invitationId: z.uuid() });

export const invitationRouter = Router();
invitationRouter.use(requireAuth);

invitationRouter.get("/", async (request, response) => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: authenticatedUserId(request) },
    select: { email: true },
  });
  await prisma.teamInvitation.updateMany({
    where: { email: user.email, status: "PENDING", expiresAt: { lte: new Date() } },
    data: { status: "EXPIRED" },
  });
  const invitations = await prisma.teamInvitation.findMany({
    where: { email: user.email },
    orderBy: { createdAt: "desc" },
    include: { team: true, invitedBy: { select: publicUserSelect } },
  });
  response.status(200).json({ data: invitations });
});

invitationRouter.post(
  "/:invitationId/accept",
  validate({ params: invitationParams }),
  async (request, response) => {
    const userId = authenticatedUserId(request);
    const { invitationId } = invitationParams.parse(request.params);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const invitation = await prisma.teamInvitation.findUnique({ where: { id: invitationId } });
    if (!invitation || invitation.email !== user.email) throw notFound("Invitation");
    if (invitation.status !== "PENDING") throw conflict("Invitation is no longer pending");
    if (invitation.expiresAt <= new Date()) {
      await prisma.teamInvitation.update({
        where: { id: invitation.id },
        data: { status: "EXPIRED" },
      });
      throw conflict("Invitation has expired");
    }
    const membership = await prisma.$transaction(async (transaction) => {
      const created = await transaction.teamMember.create({
        data: { teamId: invitation.teamId, userId, role: invitation.role },
        include: { team: true, user: { select: publicUserSelect } },
      });
      await transaction.teamInvitation.update({
        where: { id: invitation.id },
        data: { status: "ACCEPTED", acceptedById: userId },
      });
      return created;
    });
    response.status(200).json({ data: membership });
  },
);

invitationRouter.post(
  "/:invitationId/decline",
  validate({ params: invitationParams }),
  async (request, response) => {
    const userId = authenticatedUserId(request);
    const { invitationId } = invitationParams.parse(request.params);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const result = await prisma.teamInvitation.updateMany({
      where: { id: invitationId, email: user.email, status: "PENDING" },
      data: { status: "DECLINED" },
    });
    if (result.count === 0) throw notFound("Pending invitation");
    response.status(204).send();
  },
);
