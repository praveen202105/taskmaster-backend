import { randomUUID } from "node:crypto";

import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";

import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { attachmentRouter } from "./modules/attachments/attachment.routes.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { commentRouter } from "./modules/comments/comment.routes.js";
import { healthRouter } from "./modules/health/health.routes.js";
import { invitationRouter } from "./modules/invitations/invitation.routes.js";
import { projectRouter } from "./modules/projects/project.routes.js";
import { teamRouter } from "./modules/teams/team.routes.js";
import { taskRouter } from "./modules/tasks/task.routes.js";
import { userRouter } from "./modules/users/user.routes.js";
import { errorHandler, notFoundHandler } from "./shared/http/error-handler.js";
import { apiRateLimit } from "./shared/http/rate-limit.js";

export const createApp = () => {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", env.TRUST_PROXY);
  app.use(
    pinoHttp({
      logger,
      genReqId: (request, response) => {
        const requestId = request.headers["x-request-id"]?.toString() ?? randomUUID();
        response.setHeader("x-request-id", requestId);
        return requestId;
      },
    }),
  );
  app.use(helmet());
  app.use(
    cors({
      credentials: true,
      origin(origin, callback) {
        if (!origin || env.corsOrigins.includes(origin)) return callback(null, true);
        return callback(null, false);
      },
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false, limit: "1mb" }));
  app.use(cookieParser());

  if (env.NODE_ENV !== "test") app.use(apiRateLimit);

  app.use("/api/v1/health", healthRouter);
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/users", userRouter);
  app.use("/api/v1/teams", teamRouter);
  app.use("/api/v1/invitations", invitationRouter);
  app.use("/api/v1", projectRouter);
  app.use("/api/v1", taskRouter);
  app.use("/api/v1", commentRouter);
  app.use("/api/v1", attachmentRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
