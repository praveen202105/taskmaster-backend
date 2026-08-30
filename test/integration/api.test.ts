import { rm } from "node:fs/promises";

import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { prisma } from "../../src/config/database.js";

const app = createApp();

const cleanDatabase = async () => {
  await prisma.$transaction([
    prisma.attachment.deleteMany(),
    prisma.comment.deleteMany(),
    prisma.task.deleteMany(),
    prisma.project.deleteMany(),
    prisma.teamInvitation.deleteMany(),
    prisma.teamMember.deleteMany(),
    prisma.team.deleteMany(),
    prisma.refreshSession.deleteMany(),
    prisma.user.deleteMany(),
  ]);
};

const registerUser = async (
  agent: ReturnType<typeof request.agent>,
  name: string,
  email: string,
) => {
  const response = await agent.post("/api/v1/auth/register").send({
    name,
    email,
    password: "A-strong-test-password!",
  });
  expect(response.status).toBe(201);
  return {
    accessToken: response.body.data.accessToken as string,
    user: response.body.data.user as { id: string; email: string; name: string },
    cookie: (response.headers["set-cookie"] as unknown as string[])[0]!,
  };
};

const bearer = (accessToken: string) => ({ Authorization: `Bearer ${accessToken}` });

beforeEach(async () => {
  await cleanDatabase();
  await rm("./tmp/test-uploads", { recursive: true, force: true });
});

afterAll(async () => {
  await cleanDatabase();
  await prisma.$disconnect();
});

describe("TaskMaster API", () => {
  it("returns health, documentation, validation, and consistent route errors", async () => {
    const live = await request(app).get("/api/v1/health/live");
    expect(live.status).toBe(200);
    expect(live.body).toEqual({ data: { status: "ok" } });

    const ready = await request(app).get("/api/v1/health/ready");
    expect(ready.status).toBe(200);

    const docs = await request(app).get("/openapi.json");
    expect(docs.status).toBe(200);
    expect(docs.body.openapi).toBe("3.1.0");
    expect(docs.body.paths["/api/v1/tasks"]).toBeDefined();

    const invalid = await request(app).post("/api/v1/auth/register").send({ email: "invalid" });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(invalid.body.error.requestId).toBeTypeOf("string");

    const missing = await request(app).get("/not-a-route");
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("ROUTE_NOT_FOUND");
  });

  it("registers, logs in, rotates sessions, updates profiles, and logs out", async () => {
    const agent = request.agent(app);
    const registered = await registerUser(agent, "Owner User", "  OWNER@EXAMPLE.COM ");
    expect(registered.user.email).toBe("owner@example.com");

    const profile = await agent.get("/api/v1/users/me").set(bearer(registered.accessToken));
    expect(profile.status).toBe(200);
    expect(profile.body.data.name).toBe("Owner User");

    const updated = await agent
      .patch("/api/v1/users/me")
      .set(bearer(registered.accessToken))
      .send({ name: "Updated Owner", avatarUrl: "https://example.com/avatar.png" });
    expect(updated.status).toBe(200);
    expect(updated.body.data.name).toBe("Updated Owner");

    const wrongLogin = await request(app).post("/api/v1/auth/login").send({
      email: "owner@example.com",
      password: "wrong-password",
    });
    expect(wrongLogin.status).toBe(401);

    const refreshed = await agent.post("/api/v1/auth/refresh");
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.accessToken).not.toBe(registered.accessToken);
    const rotatedCookie = (refreshed.headers["set-cookie"] as unknown as string[])[0]!;

    const reused = await request(app).post("/api/v1/auth/refresh").set("Cookie", registered.cookie);
    expect(reused.status).toBe(401);
    expect(reused.body.error.message).toContain("reuse");

    const revokedFamily = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", rotatedCookie);
    expect(revokedFamily.status).toBe(401);

    const loggedIn = await agent.post("/api/v1/auth/login").send({
      email: "owner@example.com",
      password: "A-strong-test-password!",
    });
    expect(loggedIn.status).toBe(200);
    const logout = await agent.post("/api/v1/auth/logout");
    expect(logout.status).toBe(204);
    const refreshAfterLogout = await agent.post("/api/v1/auth/refresh");
    expect(refreshAfterLogout.status).toBe(401);
  });

  it("supports teams, invitations, projects, assigned tasks, comments, and attachments", async () => {
    const ownerAgent = request.agent(app);
    const memberAgent = request.agent(app);
    const outsiderAgent = request.agent(app);
    const owner = await registerUser(ownerAgent, "Owner", "owner@example.com");
    const member = await registerUser(memberAgent, "Member", "member@example.com");
    const outsider = await registerUser(outsiderAgent, "Outsider", "outsider@example.com");

    const teamResponse = await ownerAgent
      .post("/api/v1/teams")
      .set(bearer(owner.accessToken))
      .send({ name: "Platform Team", description: "Build TaskMaster" });
    expect(teamResponse.status).toBe(201);
    const teamId = teamResponse.body.data.id as string;

    const projectResponse = await ownerAgent
      .post(`/api/v1/teams/${teamId}/projects`)
      .set(bearer(owner.accessToken))
      .send({ name: "Production Launch", description: "Prepare the API" });
    expect(projectResponse.status).toBe(201);
    const projectId = projectResponse.body.data.id as string;

    const invitationResponse = await ownerAgent
      .post(`/api/v1/teams/${teamId}/invitations`)
      .set(bearer(owner.accessToken))
      .send({ email: member.user.email, role: "MEMBER" });
    expect(invitationResponse.status).toBe(201);
    const invitationId = invitationResponse.body.data.id as string;

    const invitations = await memberAgent
      .get("/api/v1/invitations")
      .set(bearer(member.accessToken));
    expect(invitations.body.data).toHaveLength(1);

    const accepted = await memberAgent
      .post(`/api/v1/invitations/${invitationId}/accept`)
      .set(bearer(member.accessToken));
    expect(accepted.status).toBe(200);

    const taskResponse = await ownerAgent
      .post(`/api/v1/projects/${projectId}/tasks`)
      .set(bearer(owner.accessToken))
      .send({
        title: "Review security controls",
        description: "Review authentication and authorization before release",
        dueDate: "2026-09-15T10:00:00+05:30",
        priority: "HIGH",
        assigneeId: member.user.id,
      });
    expect(taskResponse.status).toBe(201);
    const taskId = taskResponse.body.data.id as string;

    const assignedTasks = await memberAgent
      .get("/api/v1/tasks")
      .query({ assignee: "me", status: "OPEN", priority: "HIGH", q: "security" })
      .set(bearer(member.accessToken));
    expect(assignedTasks.status).toBe(200);
    expect(assignedTasks.body.data).toHaveLength(1);
    expect(assignedTasks.body.meta.total).toBe(1);

    const completed = await memberAgent
      .patch(`/api/v1/tasks/${taskId}`)
      .set(bearer(member.accessToken))
      .send({ status: "COMPLETED" });
    expect(completed.status).toBe(200);
    expect(completed.body.data.completedAt).toBeTypeOf("string");

    const forbiddenEdit = await memberAgent
      .patch(`/api/v1/tasks/${taskId}`)
      .set(bearer(member.accessToken))
      .send({ title: "Unauthorized title change" });
    expect(forbiddenEdit.status).toBe(403);

    const outsiderRead = await outsiderAgent
      .get(`/api/v1/tasks/${taskId}`)
      .set(bearer(outsider.accessToken));
    expect(outsiderRead.status).toBe(403);
    const outsiderList = await outsiderAgent.get("/api/v1/tasks").set(bearer(outsider.accessToken));
    expect(outsiderList.body.data).toHaveLength(0);

    const commentResponse = await memberAgent
      .post(`/api/v1/tasks/${taskId}/comments`)
      .set(bearer(member.accessToken))
      .send({ body: "Security controls look good." });
    expect(commentResponse.status).toBe(201);
    const commentId = commentResponse.body.data.id as string;
    const commentList = await ownerAgent
      .get(`/api/v1/tasks/${taskId}/comments`)
      .set(bearer(owner.accessToken));
    expect(commentList.body.data).toHaveLength(1);
    const ownerDeleteComment = await ownerAgent
      .delete(`/api/v1/comments/${commentId}`)
      .set(bearer(owner.accessToken));
    expect(ownerDeleteComment.status).toBe(204);

    const attachmentResponse = await memberAgent
      .post(`/api/v1/tasks/${taskId}/attachments`)
      .set(bearer(member.accessToken))
      .attach("file", Buffer.from("production evidence", "utf8"), {
        filename: "evidence.txt",
        contentType: "text/plain",
      });
    expect(attachmentResponse.status).toBe(201);
    const attachmentId = attachmentResponse.body.data.id as string;

    const attachmentDownload = await ownerAgent
      .get(`/api/v1/attachments/${attachmentId}/content`)
      .set(bearer(owner.accessToken));
    expect(attachmentDownload.status).toBe(200);
    expect(attachmentDownload.headers["content-disposition"]).toContain("evidence.txt");

    const outsiderDownload = await outsiderAgent
      .get(`/api/v1/attachments/${attachmentId}/content`)
      .set(bearer(outsider.accessToken));
    expect(outsiderDownload.status).toBe(403);

    const deleteAttachment = await ownerAgent
      .delete(`/api/v1/attachments/${attachmentId}`)
      .set(bearer(owner.accessToken));
    expect(deleteAttachment.status).toBe(204);

    const removeMember = await ownerAgent
      .delete(`/api/v1/teams/${teamId}/members/${member.user.id}`)
      .set(bearer(owner.accessToken));
    expect(removeMember.status).toBe(204);
    const taskAfterRemoval = await ownerAgent
      .get(`/api/v1/tasks/${taskId}`)
      .set(bearer(owner.accessToken));
    expect(taskAfterRemoval.body.data.assignee).toBeNull();
  });
});
