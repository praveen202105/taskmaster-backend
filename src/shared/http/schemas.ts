import { z } from "zod";

export const idParamsSchema = <Key extends string>(name: Key) => {
  const uuidSchema = z.uuid();
  return z.object({ [name]: uuidSchema } as Record<Key, typeof uuidSchema>);
};

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const normalizedEmailSchema = z
  .email()
  .max(320)
  .transform((email) => email.trim().toLowerCase());
