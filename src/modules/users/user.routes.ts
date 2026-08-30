import { Router } from "express";

import { prisma } from "../../config/database.js";
import { authenticatedUserId, requireAuth } from "../../shared/auth/auth.middleware.js";
import { hashPassword, verifyPassword } from "../../shared/auth/password.js";
import { unauthorized } from "../../shared/errors/app-error.js";
import { validate } from "../../shared/http/validate.js";
import { publicUserSelect } from "../../shared/serialization/user.js";
import { changePasswordSchema, updateProfileSchema } from "./user.schemas.js";

export const userRouter = Router();
userRouter.use(requireAuth);

userRouter.get("/me", async (request, response) => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: authenticatedUserId(request) },
    select: publicUserSelect,
  });
  response.status(200).json({ data: user });
});

userRouter.patch("/me", validate({ body: updateProfileSchema }), async (request, response) => {
  const body = updateProfileSchema.parse(request.body);
  const user = await prisma.user.update({
    where: { id: authenticatedUserId(request) },
    data: body,
    select: publicUserSelect,
  });
  response.status(200).json({ data: user });
});

userRouter.patch(
  "/me/password",
  validate({ body: changePasswordSchema }),
  async (request, response) => {
    const userId = authenticatedUserId(request);
    const body = changePasswordSchema.parse(request.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await verifyPassword(user.passwordHash, body.currentPassword))) {
      throw unauthorized("Current password is incorrect");
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { passwordHash: await hashPassword(body.newPassword) },
      }),
      prisma.refreshSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    response.status(204).send();
  },
);
