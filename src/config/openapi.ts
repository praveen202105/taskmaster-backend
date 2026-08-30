import {
  extendZodWithOpenApi,
  OpenApiGeneratorV31,
  OpenAPIRegistry,
  type RouteConfig,
} from "@asteasolutions/zod-to-openapi";
import { z, type ZodType } from "zod";

import { loginSchema, registerSchema } from "../modules/auth/auth.schemas.js";
import { commentBodySchema } from "../modules/comments/comment.schemas.js";
import { createProjectSchema, updateProjectSchema } from "../modules/projects/project.schemas.js";
import {
  createTaskSchema,
  taskListQuerySchema,
  updateTaskSchema,
} from "../modules/tasks/task.schemas.js";
import {
  createInvitationSchema,
  createTeamSchema,
  updateTeamSchema,
} from "../modules/teams/team.schemas.js";
import { changePasswordSchema, updateProfileSchema } from "../modules/users/user.schemas.js";

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();
registry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
});

const dataResponseSchema = z.object({ data: z.unknown() });
const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.object({ field: z.string().optional(), message: z.string() })).optional(),
    requestId: z.string().optional(),
  }),
});

registry.register("DataResponse", dataResponseSchema);
registry.register("ErrorResponse", errorResponseSchema);
const pathParams = (...names: string[]) =>
  z.object(
    Object.fromEntries(
      names.map((name) => [name, z.uuid().openapi({ param: { name, in: "path" } })]),
    ),
  );

interface RouteOptions {
  body?: ZodType;
  query?: NonNullable<RouteConfig["request"]>["query"];
  params?: NonNullable<RouteConfig["request"]>["params"];
  secured?: boolean;
  status?: number;
}

const addRoute = (
  method: RouteConfig["method"],
  path: string,
  summary: string,
  tag: string,
  options: RouteOptions = {},
) => {
  const status = options.status ?? (method === "post" ? 201 : 200);
  registry.registerPath({
    method,
    path,
    summary,
    tags: [tag],
    ...(options.secured ? { security: [{ bearerAuth: [] }] } : {}),
    request: {
      ...(options.params ? { params: options.params } : {}),
      ...(options.query ? { query: options.query } : {}),
      ...(options.body
        ? {
            body: {
              required: true,
              content: { "application/json": { schema: options.body } },
            },
          }
        : {}),
    },
    responses: {
      [status]: {
        description: status === 204 ? "Operation completed" : "Successful response",
        ...(status === 204
          ? {}
          : { content: { "application/json": { schema: dataResponseSchema } } }),
      },
      "400": {
        description: "Invalid request",
        content: { "application/json": { schema: errorResponseSchema } },
      },
      "401": {
        description: "Authentication required",
        content: { "application/json": { schema: errorResponseSchema } },
      },
      "403": {
        description: "Insufficient permission",
        content: { "application/json": { schema: errorResponseSchema } },
      },
      "404": {
        description: "Resource not found",
        content: { "application/json": { schema: errorResponseSchema } },
      },
    },
  });
};

addRoute("get", "/api/v1/health/live", "Liveness check", "Health");
addRoute("get", "/api/v1/health/ready", "Database readiness check", "Health");
addRoute("post", "/api/v1/auth/register", "Register a user", "Authentication", {
  body: registerSchema,
});
addRoute("post", "/api/v1/auth/login", "Log in", "Authentication", {
  body: loginSchema,
  status: 200,
});
addRoute("post", "/api/v1/auth/refresh", "Rotate a refresh session", "Authentication", {
  status: 200,
});
addRoute("post", "/api/v1/auth/logout", "Revoke the current session", "Authentication", {
  status: 204,
});
addRoute("get", "/api/v1/users/me", "Get current profile", "Users", { secured: true });
addRoute("patch", "/api/v1/users/me", "Update current profile", "Users", {
  secured: true,
  body: updateProfileSchema,
});
addRoute("patch", "/api/v1/users/me/password", "Change password", "Users", {
  secured: true,
  body: changePasswordSchema,
  status: 204,
});
addRoute("post", "/api/v1/teams", "Create a team", "Teams", {
  secured: true,
  body: createTeamSchema,
});
addRoute("get", "/api/v1/teams", "List current user's teams", "Teams", { secured: true });
addRoute("get", "/api/v1/teams/{teamId}", "Get a team", "Teams", {
  secured: true,
  params: pathParams("teamId"),
});
addRoute("patch", "/api/v1/teams/{teamId}", "Update a team", "Teams", {
  secured: true,
  params: pathParams("teamId"),
  body: updateTeamSchema,
});
addRoute("delete", "/api/v1/teams/{teamId}", "Delete a team", "Teams", {
  secured: true,
  params: pathParams("teamId"),
  status: 204,
});
addRoute("get", "/api/v1/teams/{teamId}/members", "List team members", "Teams", {
  secured: true,
  params: pathParams("teamId"),
});
addRoute("delete", "/api/v1/teams/{teamId}/members/{userId}", "Remove or leave a team", "Teams", {
  secured: true,
  params: pathParams("teamId", "userId"),
  status: 204,
});
addRoute("post", "/api/v1/teams/{teamId}/invitations", "Invite a team member", "Invitations", {
  secured: true,
  params: pathParams("teamId"),
  body: createInvitationSchema,
});
addRoute(
  "delete",
  "/api/v1/teams/{teamId}/invitations/{invitationId}",
  "Revoke an invitation",
  "Invitations",
  { secured: true, params: pathParams("teamId", "invitationId"), status: 204 },
);
addRoute("get", "/api/v1/invitations", "List current user's invitations", "Invitations", {
  secured: true,
});
addRoute(
  "post",
  "/api/v1/invitations/{invitationId}/accept",
  "Accept an invitation",
  "Invitations",
  { secured: true, params: pathParams("invitationId"), status: 200 },
);
addRoute(
  "post",
  "/api/v1/invitations/{invitationId}/decline",
  "Decline an invitation",
  "Invitations",
  { secured: true, params: pathParams("invitationId"), status: 204 },
);
addRoute("get", "/api/v1/teams/{teamId}/projects", "List team projects", "Projects", {
  secured: true,
  params: pathParams("teamId"),
});
addRoute("post", "/api/v1/teams/{teamId}/projects", "Create a project", "Projects", {
  secured: true,
  params: pathParams("teamId"),
  body: createProjectSchema,
});
addRoute("get", "/api/v1/projects/{projectId}", "Get a project", "Projects", {
  secured: true,
  params: pathParams("projectId"),
});
addRoute("patch", "/api/v1/projects/{projectId}", "Update a project", "Projects", {
  secured: true,
  params: pathParams("projectId"),
  body: updateProjectSchema,
});
addRoute("delete", "/api/v1/projects/{projectId}", "Delete a project", "Projects", {
  secured: true,
  params: pathParams("projectId"),
  status: 204,
});
addRoute("post", "/api/v1/projects/{projectId}/tasks", "Create a task", "Tasks", {
  secured: true,
  params: pathParams("projectId"),
  body: createTaskSchema,
});
addRoute("get", "/api/v1/tasks", "Filter and search tasks", "Tasks", {
  secured: true,
  query: taskListQuerySchema,
});
addRoute("get", "/api/v1/tasks/{taskId}", "Get a task", "Tasks", {
  secured: true,
  params: pathParams("taskId"),
});
addRoute("patch", "/api/v1/tasks/{taskId}", "Update or complete a task", "Tasks", {
  secured: true,
  params: pathParams("taskId"),
  body: updateTaskSchema,
});
addRoute("delete", "/api/v1/tasks/{taskId}", "Delete a task", "Tasks", {
  secured: true,
  params: pathParams("taskId"),
  status: 204,
});
addRoute("get", "/api/v1/tasks/{taskId}/comments", "List task comments", "Comments", {
  secured: true,
  params: pathParams("taskId"),
});
addRoute("post", "/api/v1/tasks/{taskId}/comments", "Add a task comment", "Comments", {
  secured: true,
  params: pathParams("taskId"),
  body: commentBodySchema,
});
addRoute("patch", "/api/v1/comments/{commentId}", "Update a comment", "Comments", {
  secured: true,
  params: pathParams("commentId"),
  body: commentBodySchema,
});
addRoute("delete", "/api/v1/comments/{commentId}", "Delete a comment", "Comments", {
  secured: true,
  params: pathParams("commentId"),
  status: 204,
});
addRoute("get", "/api/v1/tasks/{taskId}/attachments", "List task attachments", "Attachments", {
  secured: true,
  params: pathParams("taskId"),
});
addRoute(
  "post",
  "/api/v1/tasks/{taskId}/attachments",
  "Upload a multipart attachment in field 'file'",
  "Attachments",
  { secured: true, params: pathParams("taskId") },
);
addRoute(
  "get",
  "/api/v1/attachments/{attachmentId}/content",
  "Download an attachment",
  "Attachments",
  { secured: true, params: pathParams("attachmentId") },
);
addRoute("delete", "/api/v1/attachments/{attachmentId}", "Delete an attachment", "Attachments", {
  secured: true,
  params: pathParams("attachmentId"),
  status: 204,
});

export const openApiDocument = new OpenApiGeneratorV31(registry.definitions, {
  sortComponents: "alphabetically",
}).generateDocument({
  openapi: "3.1.0",
  info: {
    title: "TaskMaster API",
    version: "1.0.0",
    description: "Collaborative task tracking API for teams and projects.",
  },
  servers: [{ url: "/", description: "Current server" }],
  tags: [
    { name: "Health" },
    { name: "Authentication" },
    { name: "Users" },
    { name: "Teams" },
    { name: "Invitations" },
    { name: "Projects" },
    { name: "Tasks" },
    { name: "Comments" },
    { name: "Attachments" },
  ],
});
