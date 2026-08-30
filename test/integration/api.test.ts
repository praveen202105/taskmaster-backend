import { rm } from "node:fs/promises";

import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { prisma } from "../../src/config/database.js";

const app = createApp();
const nonexistentId = "00000000-0000-4000-8000-000000000001";

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

    const swagger = await request(app).get("/docs/");
    expect(swagger.status).toBe(200);

    const requestId = await request(app).get("/api/v1/health/live").set("x-request-id", "test-id");
    expect(requestId.headers["x-request-id"]).toBe("test-id");

    const allowedOrigin = await request(app)
      .get("/api/v1/health/live")
      .set("Origin", "http://localhost:3000");
    expect(allowedOrigin.headers["access-control-allow-origin"]).toBe("http://localhost:3000");

    const deniedOrigin = await request(app)
      .get("/api/v1/health/live")
      .set("Origin", "https://untrusted.example");
    expect(deniedOrigin.headers["access-control-allow-origin"]).toBeUndefined();

    const invalid = await request(app).post("/api/v1/auth/register").send({ email: "invalid" });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(invalid.body.error.requestId).toBeTypeOf("string");

    const invalidJson = await request(app)
      .post("/api/v1/auth/login")
      .set("content-type", "application/json")
      .send('{"email":');
    expect(invalidJson.status).toBe(400);
    expect(invalidJson.body.error.code).toBe("INVALID_JSON");

    const unauthenticated = await request(app).get("/api/v1/users/me");
    expect(unauthenticated.status).toBe(401);

    const invalidToken = await request(app)
      .get("/api/v1/users/me")
      .set("Authorization", "Bearer invalid-token");
    expect(invalidToken.status).toBe(401);

    const missing = await request(app).get("/not-a-route");
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("ROUTE_NOT_FOUND");
  });

  it("registers, logs in, rotates sessions, updates profiles, and logs out", async () => {
    const agent = request.agent(app);
    const registered = await registerUser(agent, "Owner User", "  OWNER@EXAMPLE.COM ");
    expect(registered.user.email).toBe("owner@example.com");

    const duplicate = await request(app).post("/api/v1/auth/register").send({
      name: "Duplicate Owner",
      email: "owner@example.com",
      password: "A-strong-test-password!",
    });
    expect(duplicate.status).toBe(409);

    const missingRefresh = await request(app).post("/api/v1/auth/refresh");
    expect(missingRefresh.status).toBe(401);
    const invalidRefresh = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", "taskmaster_refresh=not-a-session");
    expect(invalidRefresh.status).toBe(401);

    const profile = await agent.get("/api/v1/users/me").set(bearer(registered.accessToken));
    expect(profile.status).toBe(200);
    expect(profile.body.data.name).toBe("Owner User");

    const updated = await agent
      .patch("/api/v1/users/me")
      .set(bearer(registered.accessToken))
      .send({ name: "Updated Owner", avatarUrl: "https://example.com/avatar.png" });
    expect(updated.status).toBe(200);
    expect(updated.body.data.name).toBe("Updated Owner");

    const emptyProfile = await agent
      .patch("/api/v1/users/me")
      .set(bearer(registered.accessToken))
      .send({});
    expect(emptyProfile.status).toBe(400);

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

    const wrongCurrentPassword = await agent
      .patch("/api/v1/users/me/password")
      .set(bearer(loggedIn.body.data.accessToken as string))
      .send({
        currentPassword: "wrong-password",
        newPassword: "An-even-stronger-password!",
      });
    expect(wrongCurrentPassword.status).toBe(401);

    const changedPassword = await agent
      .patch("/api/v1/users/me/password")
      .set(bearer(loggedIn.body.data.accessToken as string))
      .send({
        currentPassword: "A-strong-test-password!",
        newPassword: "An-even-stronger-password!",
      });
    expect(changedPassword.status).toBe(204);

    const revokedByPasswordChange = await agent.post("/api/v1/auth/refresh");
    expect(revokedByPasswordChange.status).toBe(401);
    const oldPassword = await request(app).post("/api/v1/auth/login").send({
      email: "owner@example.com",
      password: "A-strong-test-password!",
    });
    expect(oldPassword.status).toBe(401);
    const newPassword = await agent.post("/api/v1/auth/login").send({
      email: "owner@example.com",
      password: "An-even-stronger-password!",
    });
    expect(newPassword.status).toBe(200);

    const logout = await agent.post("/api/v1/auth/logout");
    expect(logout.status).toBe(204);
    const refreshAfterLogout = await agent.post("/api/v1/auth/refresh");
    expect(refreshAfterLogout.status).toBe(401);
  });

  it("enforces team and project RBAC plus invitation state transitions", async () => {
    const ownerAgent = request.agent(app);
    const adminAgent = request.agent(app);
    const memberAgent = request.agent(app);
    const outsiderAgent = request.agent(app);
    const owner = await registerUser(ownerAgent, "Owner", "owner@example.com");
    const admin = await registerUser(adminAgent, "Admin", "admin@example.com");
    const member = await registerUser(memberAgent, "Member", "member@example.com");
    const outsider = await registerUser(outsiderAgent, "Outsider", "outsider@example.com");

    const teamResponse = await ownerAgent
      .post("/api/v1/teams")
      .set(bearer(owner.accessToken))
      .send({ name: "Core Platform" });
    expect(teamResponse.status).toBe(201);
    const teamId = teamResponse.body.data.id as string;

    const teams = await ownerAgent.get("/api/v1/teams").set(bearer(owner.accessToken));
    expect(teams.body.data[0].membership.role).toBe("OWNER");
    const team = await ownerAgent.get(`/api/v1/teams/${teamId}`).set(bearer(owner.accessToken));
    expect(team.status).toBe(200);
    const outsiderTeam = await outsiderAgent
      .get(`/api/v1/teams/${teamId}`)
      .set(bearer(outsider.accessToken));
    expect(outsiderTeam.status).toBe(403);
    await ownerAgent
      .get(`/api/v1/teams/${nonexistentId}`)
      .set(bearer(owner.accessToken))
      .expect(404);

    const adminInvitation = await ownerAgent
      .post(`/api/v1/teams/${teamId}/invitations`)
      .set(bearer(owner.accessToken))
      .send({ email: admin.user.email, role: "ADMIN" });
    expect(adminInvitation.status).toBe(201);
    const acceptedAdmin = await adminAgent
      .post(`/api/v1/invitations/${adminInvitation.body.data.id as string}/accept`)
      .set(bearer(admin.accessToken));
    expect(acceptedAdmin.status).toBe(200);

    const adminCannotInviteAdmin = await adminAgent
      .post(`/api/v1/teams/${teamId}/invitations`)
      .set(bearer(admin.accessToken))
      .send({ email: outsider.user.email, role: "ADMIN" });
    expect(adminCannotInviteAdmin.status).toBe(403);

    const memberInvitation = await adminAgent
      .post(`/api/v1/teams/${teamId}/invitations`)
      .set(bearer(admin.accessToken))
      .send({ email: member.user.email, role: "MEMBER" });
    expect(memberInvitation.status).toBe(201);
    await memberAgent
      .post(`/api/v1/invitations/${memberInvitation.body.data.id as string}/accept`)
      .set(bearer(member.accessToken))
      .expect(200);

    const duplicateMemberInvitation = await ownerAgent
      .post(`/api/v1/teams/${teamId}/invitations`)
      .set(bearer(owner.accessToken))
      .send({ email: member.user.email });
    expect(duplicateMemberInvitation.status).toBe(409);

    const outsiderInvitation = await ownerAgent
      .post(`/api/v1/teams/${teamId}/invitations`)
      .set(bearer(owner.accessToken))
      .send({ email: outsider.user.email });
    expect(outsiderInvitation.status).toBe(201);
    const duplicatePending = await ownerAgent
      .post(`/api/v1/teams/${teamId}/invitations`)
      .set(bearer(owner.accessToken))
      .send({ email: outsider.user.email });
    expect(duplicatePending.status).toBe(409);
    await outsiderAgent
      .post(`/api/v1/invitations/${outsiderInvitation.body.data.id as string}/decline`)
      .set(bearer(outsider.accessToken))
      .expect(204);
    const acceptDeclined = await outsiderAgent
      .post(`/api/v1/invitations/${outsiderInvitation.body.data.id as string}/accept`)
      .set(bearer(outsider.accessToken));
    expect(acceptDeclined.status).toBe(409);

    const expiredInvitation = await ownerAgent
      .post(`/api/v1/teams/${teamId}/invitations`)
      .set(bearer(owner.accessToken))
      .send({ email: outsider.user.email });
    const expiredInvitationId = expiredInvitation.body.data.id as string;
    await ownerAgent
      .post(`/api/v1/invitations/${expiredInvitationId}/accept`)
      .set(bearer(owner.accessToken))
      .expect(404);
    await prisma.teamInvitation.update({
      where: { id: expiredInvitationId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    await outsiderAgent
      .post(`/api/v1/invitations/${expiredInvitationId}/accept`)
      .set(bearer(outsider.accessToken))
      .expect(409);

    const revokedInvitation = await ownerAgent
      .post(`/api/v1/teams/${teamId}/invitations`)
      .set(bearer(owner.accessToken))
      .send({ email: "future-member@example.com" });
    const revokedInvitationId = revokedInvitation.body.data.id as string;
    await ownerAgent
      .delete(`/api/v1/teams/${teamId}/invitations/${revokedInvitationId}`)
      .set(bearer(owner.accessToken))
      .expect(204);
    await ownerAgent
      .delete(`/api/v1/teams/${teamId}/invitations/${revokedInvitationId}`)
      .set(bearer(owner.accessToken))
      .expect(404);

    const memberCannotUpdateTeam = await memberAgent
      .patch(`/api/v1/teams/${teamId}`)
      .set(bearer(member.accessToken))
      .send({ name: "Unauthorized rename" });
    expect(memberCannotUpdateTeam.status).toBe(403);
    const updatedTeam = await adminAgent
      .patch(`/api/v1/teams/${teamId}`)
      .set(bearer(admin.accessToken))
      .send({ name: "Updated Platform" });
    expect(updatedTeam.status).toBe(200);

    const projectResponse = await ownerAgent
      .post(`/api/v1/teams/${teamId}/projects`)
      .set(bearer(owner.accessToken))
      .send({ name: "API Delivery" });
    expect(projectResponse.status).toBe(201);
    const projectId = projectResponse.body.data.id as string;
    const projects = await memberAgent
      .get(`/api/v1/teams/${teamId}/projects`)
      .set(bearer(member.accessToken));
    expect(projects.body.data).toHaveLength(1);
    await memberAgent
      .get(`/api/v1/projects/${projectId}`)
      .set(bearer(member.accessToken))
      .expect(200);
    await ownerAgent
      .get(`/api/v1/projects/${nonexistentId}`)
      .set(bearer(owner.accessToken))
      .expect(404);
    await ownerAgent
      .patch(`/api/v1/projects/${nonexistentId}`)
      .set(bearer(owner.accessToken))
      .send({ name: "Missing project" })
      .expect(404);
    const memberCannotCreateProject = await memberAgent
      .post(`/api/v1/teams/${teamId}/projects`)
      .set(bearer(member.accessToken))
      .send({ name: "Unauthorized project" });
    expect(memberCannotCreateProject.status).toBe(403);
    const updatedProject = await adminAgent
      .patch(`/api/v1/projects/${projectId}`)
      .set(bearer(admin.accessToken))
      .send({ description: "Managed by the admin" });
    expect(updatedProject.status).toBe(200);

    const members = await memberAgent
      .get(`/api/v1/teams/${teamId}/members`)
      .set(bearer(member.accessToken));
    expect(members.body.data).toHaveLength(3);
    const cannotRemoveOwner = await memberAgent
      .delete(`/api/v1/teams/${teamId}/members/${owner.user.id}`)
      .set(bearer(member.accessToken));
    expect(cannotRemoveOwner.status).toBe(403);
    const memberCannotRemoveAdmin = await memberAgent
      .delete(`/api/v1/teams/${teamId}/members/${admin.user.id}`)
      .set(bearer(member.accessToken));
    expect(memberCannotRemoveAdmin.status).toBe(403);

    await adminAgent
      .delete(`/api/v1/projects/${projectId}`)
      .set(bearer(admin.accessToken))
      .expect(204);
    await adminAgent
      .delete(`/api/v1/teams/${teamId}/members/${admin.user.id}`)
      .set(bearer(admin.accessToken))
      .expect(204);
    const memberCannotDeleteTeam = await memberAgent
      .delete(`/api/v1/teams/${teamId}`)
      .set(bearer(member.accessToken));
    expect(memberCannotDeleteTeam.status).toBe(403);
    await ownerAgent.delete(`/api/v1/teams/${teamId}`).set(bearer(owner.accessToken)).expect(204);
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

    const projectTasks = await ownerAgent
      .get("/api/v1/tasks")
      .query({ projectId, sortBy: "title", order: "asc", page: 1, limit: 5 })
      .set(bearer(owner.accessToken));
    expect(projectTasks.body.data).toHaveLength(1);
    await ownerAgent.get(`/api/v1/tasks/${taskId}`).set(bearer(owner.accessToken)).expect(200);
    await ownerAgent
      .get(`/api/v1/tasks/${nonexistentId}`)
      .set(bearer(owner.accessToken))
      .expect(404);

    const invalidAssignee = await ownerAgent
      .patch(`/api/v1/tasks/${taskId}`)
      .set(bearer(owner.accessToken))
      .send({ assigneeId: outsider.user.id });
    expect(invalidAssignee.status).toBe(403);

    const updatedTask = await ownerAgent
      .patch(`/api/v1/tasks/${taskId}`)
      .set(bearer(owner.accessToken))
      .send({ dueDate: "2026-09-20T10:00:00+05:30", priority: "MEDIUM" });
    expect(updatedTask.status).toBe(200);

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
    const updatedComment = await memberAgent
      .patch(`/api/v1/comments/${commentId}`)
      .set(bearer(member.accessToken))
      .send({ body: "Security controls and audit evidence look good." });
    expect(updatedComment.status).toBe(200);
    const commentList = await ownerAgent
      .get(`/api/v1/tasks/${taskId}/comments`)
      .set(bearer(owner.accessToken));
    expect(commentList.body.data).toHaveLength(1);
    const ownerDeleteComment = await ownerAgent
      .delete(`/api/v1/comments/${commentId}`)
      .set(bearer(owner.accessToken));
    expect(ownerDeleteComment.status).toBe(204);

    const ownerComment = await ownerAgent
      .post(`/api/v1/tasks/${taskId}/comments`)
      .set(bearer(owner.accessToken))
      .send({ body: "Owner-only release note" });
    const forbiddenCommentEdit = await memberAgent
      .patch(`/api/v1/comments/${ownerComment.body.data.id as string}`)
      .set(bearer(member.accessToken))
      .send({ body: "Unauthorized edit" });
    expect(forbiddenCommentEdit.status).toBe(403);
    const forbiddenCommentDelete = await memberAgent
      .delete(`/api/v1/comments/${ownerComment.body.data.id as string}`)
      .set(bearer(member.accessToken));
    expect(forbiddenCommentDelete.status).toBe(403);
    await ownerAgent
      .patch(`/api/v1/comments/${nonexistentId}`)
      .set(bearer(owner.accessToken))
      .send({ body: "Missing comment" })
      .expect(404);
    await ownerAgent
      .delete(`/api/v1/comments/${ownerComment.body.data.id as string}`)
      .set(bearer(owner.accessToken))
      .expect(204);

    const missingAttachment = await memberAgent
      .post(`/api/v1/tasks/${taskId}/attachments`)
      .set(bearer(member.accessToken));
    expect(missingAttachment.status).toBe(400);
    const unsupportedAttachment = await memberAgent
      .post(`/api/v1/tasks/${taskId}/attachments`)
      .set(bearer(member.accessToken))
      .attach("file", Buffer.from([0, 1, 2, 3]), {
        filename: "payload.bin",
        contentType: "application/octet-stream",
      });
    expect(unsupportedAttachment.status).toBe(415);
    const mismatchedAttachment = await memberAgent
      .post(`/api/v1/tasks/${taskId}/attachments`)
      .set(bearer(member.accessToken))
      .attach("file", Buffer.from("%PDF-1.4\n% test document", "utf8"), {
        filename: "not-really-an-image.png",
        contentType: "image/png",
      });
    expect(mismatchedAttachment.status).toBe(415);
    const invalidTextAttachment = await memberAgent
      .post(`/api/v1/tasks/${taskId}/attachments`)
      .set(bearer(member.accessToken))
      .attach("file", Buffer.from([0xff, 0xfe, 0xfd]), {
        filename: "invalid.txt",
        contentType: "text/plain",
      });
    expect(invalidTextAttachment.status).toBe(415);
    const unexpectedFileField = await memberAgent
      .post(`/api/v1/tasks/${taskId}/attachments`)
      .set(bearer(member.accessToken))
      .attach("unexpected", Buffer.from("evidence", "utf8"), {
        filename: "evidence.txt",
        contentType: "text/plain",
      });
    expect(unexpectedFileField.status).toBe(400);
    const oversizedAttachment = await memberAgent
      .post(`/api/v1/tasks/${taskId}/attachments`)
      .set(bearer(member.accessToken))
      .attach("file", Buffer.alloc(10 * 1024 * 1024 + 1), {
        filename: "too-large.txt",
        contentType: "text/plain",
      });
    expect(oversizedAttachment.status).toBe(413);

    const attachmentResponse = await memberAgent
      .post(`/api/v1/tasks/${taskId}/attachments`)
      .set(bearer(member.accessToken))
      .attach("file", Buffer.from("production evidence", "utf8"), {
        filename: "evidence.txt",
        contentType: "text/plain",
      });
    expect(attachmentResponse.status).toBe(201);
    const attachmentId = attachmentResponse.body.data.id as string;
    await ownerAgent
      .get(`/api/v1/attachments/${nonexistentId}/content`)
      .set(bearer(owner.accessToken))
      .expect(404);

    const attachmentList = await ownerAgent
      .get(`/api/v1/tasks/${taskId}/attachments`)
      .set(bearer(owner.accessToken));
    expect(attachmentList.body.data).toHaveLength(1);

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

    const deletedAttachment = await ownerAgent
      .get(`/api/v1/attachments/${attachmentId}/content`)
      .set(bearer(owner.accessToken));
    expect(deletedAttachment.status).toBe(404);

    const removeMember = await ownerAgent
      .delete(`/api/v1/teams/${teamId}/members/${member.user.id}`)
      .set(bearer(owner.accessToken));
    expect(removeMember.status).toBe(204);
    const taskAfterRemoval = await ownerAgent
      .get(`/api/v1/tasks/${taskId}`)
      .set(bearer(owner.accessToken));
    expect(taskAfterRemoval.body.data.assignee).toBeNull();

    await ownerAgent.delete(`/api/v1/tasks/${taskId}`).set(bearer(owner.accessToken)).expect(204);
  });
});
