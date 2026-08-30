import { prisma } from "../src/config/database.js";
import { hashPassword } from "../src/shared/auth/password.js";

const seedPassword = process.env.SEED_PASSWORD ?? "TaskMasterDemo123!";

if (process.env.NODE_ENV === "production" && !process.env.SEED_PASSWORD) {
  throw new Error("SEED_PASSWORD must be set when seeding a production database");
}

const passwordHash = await hashPassword(seedPassword);

const owner = await prisma.user.upsert({
  where: { email: "owner@taskmaster.local" },
  update: { name: "TaskMaster Owner", passwordHash },
  create: {
    email: "owner@taskmaster.local",
    name: "TaskMaster Owner",
    passwordHash,
  },
});

const member = await prisma.user.upsert({
  where: { email: "member@taskmaster.local" },
  update: { name: "TaskMaster Member", passwordHash },
  create: {
    email: "member@taskmaster.local",
    name: "TaskMaster Member",
    passwordHash,
  },
});

let team = await prisma.team.findFirst({ where: { ownerId: owner.id, name: "Demo Team" } });
if (!team) {
  team = await prisma.$transaction(async (transaction) => {
    const created = await transaction.team.create({
      data: {
        name: "Demo Team",
        description: "Seeded team for local development",
        ownerId: owner.id,
      },
    });
    await transaction.teamMember.create({
      data: { teamId: created.id, userId: owner.id, role: "OWNER" },
    });
    return created;
  });
}

await prisma.teamMember.upsert({
  where: { teamId_userId: { teamId: team.id, userId: member.id } },
  update: { role: "MEMBER" },
  create: { teamId: team.id, userId: member.id, role: "MEMBER" },
});

const project = await prisma.project.upsert({
  where: { teamId_name: { teamId: team.id, name: "Launch TaskMaster" } },
  update: { description: "Production readiness project" },
  create: {
    teamId: team.id,
    name: "Launch TaskMaster",
    description: "Production readiness project",
    createdById: owner.id,
  },
});

const existingTask = await prisma.task.findFirst({
  where: { projectId: project.id, title: "Review production checklist" },
});
if (!existingTask) {
  const dueDate = new Date();
  dueDate.setUTCDate(dueDate.getUTCDate() + 7);
  await prisma.task.create({
    data: {
      projectId: project.id,
      title: "Review production checklist",
      description: "Verify migrations, API documentation, tests, and observability.",
      dueDate,
      priority: "HIGH",
      createdById: owner.id,
      assigneeId: member.id,
    },
  });
}

await prisma.$disconnect();
