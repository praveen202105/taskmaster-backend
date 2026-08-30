import { createServer } from "node:http";

import { createApp } from "./app.js";
import { prisma } from "./config/database.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";

const server = createServer(createApp());

server.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "TaskMaster API is listening");
});

const shutdown = (signal: string) => {
  logger.info({ signal }, "Shutting down TaskMaster API");
  server.close((error) => {
    void prisma.$disconnect().then(() => {
      if (error) {
        logger.error({ err: error }, "HTTP server shutdown failed");
        process.exit(1);
      }
      process.exit(0);
    });
  });

  setTimeout(() => {
    logger.error("Forced shutdown after timeout");
    process.exit(1);
  }, 10_000).unref();
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
