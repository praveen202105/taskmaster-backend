import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().startsWith("postgresql://"),
  JWT_ACCESS_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL: z
    .string()
    .regex(/^\d+[smhd]$/)
    .default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  REFRESH_COOKIE_NAME: z.string().min(1).default("taskmaster_refresh"),
  CORS_ORIGINS: z.string().default("http://localhost:3000,http://localhost:5173"),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  UPLOAD_DIR: z.string().min(1).default("./uploads"),
  MAX_ATTACHMENT_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 1024 * 1024),
  ALLOWED_ATTACHMENT_MIME_TYPES: z
    .string()
    .default("image/jpeg,image/png,image/webp,application/pdf,text/plain"),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

const parsedEnvironment = environmentSchema.safeParse(process.env);

if (!parsedEnvironment.success) {
  const issues = parsedEnvironment.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join(", ");
  throw new Error(`Invalid environment configuration: ${issues}`);
}

export const env = {
  ...parsedEnvironment.data,
  corsOrigins: parsedEnvironment.data.CORS_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  allowedAttachmentMimeTypes: new Set(
    parsedEnvironment.data.ALLOWED_ATTACHMENT_MIME_TYPES.split(",")
      .map((mimeType) => mimeType.trim().toLowerCase())
      .filter(Boolean),
  ),
};

export type Environment = typeof env;
