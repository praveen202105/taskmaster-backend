import { z } from "zod";

import { passwordSchema } from "../auth/auth.schemas.js";

export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    avatarUrl: z.url().max(2048).nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, "At least one field is required");

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});
