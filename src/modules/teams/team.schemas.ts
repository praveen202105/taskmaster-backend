import { z } from "zod";

import { TeamRole } from "../../generated/prisma/enums.js";
import { normalizedEmailSchema } from "../../shared/http/schemas.js";

export const createTeamSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
});

export const updateTeamSchema = createTeamSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });

export const createInvitationSchema = z.object({
  email: normalizedEmailSchema,
  role: z.enum([TeamRole.ADMIN, TeamRole.MEMBER]).default(TeamRole.MEMBER),
});
