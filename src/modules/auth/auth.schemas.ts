import { z } from "zod";

import { normalizedEmailSchema } from "../../shared/http/schemas.js";

const passwordSchema = z.string().min(12, "Password must contain at least 12 characters").max(128);

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: normalizedEmailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: normalizedEmailSchema,
  password: z.string().min(1).max(128),
});

export { passwordSchema };
