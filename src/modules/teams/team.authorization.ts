import { TeamRole } from "../../generated/prisma/enums.js";
import { prisma } from "../../config/database.js";
import { forbidden, notFound } from "../../shared/errors/app-error.js";

export const getTeamMembership = async (teamId: string, userId: string) => {
  const membership = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId } },
  });
  if (!membership) {
    const teamExists = await prisma.team.findUnique({
      where: { id: teamId },
      select: { id: true },
    });
    if (!teamExists) throw notFound("Team");
    throw forbidden("You are not a member of this team");
  }
  return membership;
};

export const requireTeamManager = async (teamId: string, userId: string) => {
  const membership = await getTeamMembership(teamId, userId);
  if (membership.role !== TeamRole.OWNER && membership.role !== TeamRole.ADMIN) {
    throw forbidden("Team owner or administrator access is required");
  }
  return membership;
};

export const requireTeamOwner = async (teamId: string, userId: string) => {
  const membership = await getTeamMembership(teamId, userId);
  if (membership.role !== TeamRole.OWNER) throw forbidden("Team owner access is required");
  return membership;
};
