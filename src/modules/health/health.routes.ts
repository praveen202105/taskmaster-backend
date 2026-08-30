import { Router } from "express";

import { prisma } from "../../config/database.js";

export const healthRouter = Router();

healthRouter.get("/live", (_request, response) => {
  response.status(200).json({ data: { status: "ok" } });
});

healthRouter.get("/ready", async (_request, response) => {
  await prisma.$queryRaw`SELECT 1`;
  response.status(200).json({ data: { status: "ready" } });
});
