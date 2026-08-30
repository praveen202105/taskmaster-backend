import { z } from "zod";

export const commentBodySchema = z.object({
  body: z.string().trim().min(1).max(5000),
});
