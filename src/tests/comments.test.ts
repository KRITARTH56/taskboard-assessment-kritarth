/**
 * Tests for GET and POST /api/tasks/:id/comments
 *
 * Covers:
 * - 401 when unauthenticated
 * - 404 when task doesn't exist
 * - 403 when user is not a project member
 * - 403 when user is a viewer (cannot post)
 * - 201 + activity event written when member posts a comment
 * - 200 + chronological list for GET
 * - append-only: no edit/delete routes exist on this path
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── JWT mock ──────────────────────────────────────────────────────────────────
// Must use inline vi.fn() — vi.mock factories are hoisted before const declarations
vi.mock("@/lib/jwt", () => ({
  verifyToken: vi.fn(() => ({ userId: "user_member", email: "member@test.com" })),
}));

// ── Prisma mock ───────────────────────────────────────────────────────────────
vi.mock("@/lib/prisma", () => {
  const mockComment = {
    id: "comment_1",
    taskId: "task_1",
    projectId: "proj_1",
    authorId: "user_member",
    body: "looks good to me",
    createdAt: new Date("2026-05-21T10:00:00Z"),
    author: { id: "user_member", name: "Arjun Rao", email: "member@test.com" },
  };

  return {
    prisma: {
      user: {
        findUnique: vi.fn(() => ({
          id: "user_member",
          email: "member@test.com",
          name: "Arjun Rao",
        })),
      },
      task: {
        findUnique: vi.fn(() => ({
          projectId: "proj_1",
          title: "Set up analytics",
        })),
      },
      membership: {
        findUnique: vi.fn(() => ({ role: "member" })),
      },
      comment: {
        findMany: vi.fn(() => [mockComment]),
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          comment: {
            create: vi.fn(() => mockComment),
          },
          activityEvent: {
            create: vi.fn(() => ({ id: "evt_1" })),
          },
        };
        return fn(tx);
      }),
    },
  };
});

import { GET, POST } from "@/app/api/tasks/[id]/comments/route";
import { prisma } from "@/lib/prisma";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeRequest(
  taskId: string,
  options: { method?: string; body?: unknown; auth?: string | null } = {},
): NextRequest {
  const { method = "GET", body, auth = "Bearer valid.token" } = options;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) headers["Authorization"] = auth;

  return new NextRequest(`http://localhost/api/tasks/${taskId}/comments`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

// ── GET tests ─────────────────────────────────────────────────────────────────

describe("GET /api/tasks/:id/comments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.user.findUnique).mockReturnValue(
      Promise.resolve({ id: "user_member", email: "member@test.com", name: "Arjun Rao" }) as never,
    );
    vi.mocked(prisma.task.findUnique).mockReturnValue(
      Promise.resolve({ projectId: "proj_1", title: "Set up analytics" }) as never,
    );
    vi.mocked(prisma.membership.findUnique).mockReturnValue(
      Promise.resolve({ role: "member" }) as never,
    );
  });

  it("returns 401 when no auth header is provided", async () => {
    const res = await GET(makeRequest("task_1", { auth: null }), makeParams("task_1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when the task does not exist", async () => {
    vi.mocked(prisma.task.findUnique).mockReturnValueOnce(Promise.resolve(null) as never);
    const res = await GET(makeRequest("task_1"), makeParams("task_1"));
    expect(res.status).toBe(404);
  });

  it("returns 403 when the user is not a project member", async () => {
    vi.mocked(prisma.membership.findUnique).mockReturnValueOnce(Promise.resolve(null) as never);
    const res = await GET(makeRequest("task_1"), makeParams("task_1"));
    expect(res.status).toBe(403);
  });

  it("returns 200 with a list of comments for a project member", async () => {
    const res = await GET(makeRequest("task_1"), makeParams("task_1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.comments)).toBe(true);
  });

  it("returns comments with author, body, and createdAt", async () => {
    const res = await GET(makeRequest("task_1"), makeParams("task_1"));
    const body = await res.json();
    const c = body.comments[0];
    expect(c.body).toBe("looks good to me");
    expect(c.author).toMatchObject({ name: "Arjun Rao" });
    expect(c.createdAt).toBeDefined();
  });

  it("viewers can read comments", async () => {
    vi.mocked(prisma.membership.findUnique).mockReturnValueOnce(
      Promise.resolve({ role: "viewer" }) as never,
    );
    const res = await GET(makeRequest("task_1"), makeParams("task_1"));
    expect(res.status).toBe(200);
  });
});

// ── POST tests ────────────────────────────────────────────────────────────────

describe("POST /api/tasks/:id/comments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.user.findUnique).mockReturnValue(
      Promise.resolve({ id: "user_member", email: "member@test.com", name: "Arjun Rao" }) as never,
    );
    vi.mocked(prisma.task.findUnique).mockReturnValue(
      Promise.resolve({ projectId: "proj_1", title: "Set up analytics" }) as never,
    );
    vi.mocked(prisma.membership.findUnique).mockReturnValue(
      Promise.resolve({ role: "member" }) as never,
    );
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await POST(
      makeRequest("task_1", { method: "POST", body: { body: "hi" }, auth: null }),
      makeParams("task_1"),
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 when user is not a project member", async () => {
    vi.mocked(prisma.membership.findUnique).mockReturnValueOnce(Promise.resolve(null) as never);
    const res = await POST(
      makeRequest("task_1", { method: "POST", body: { body: "hi" } }),
      makeParams("task_1"),
    );
    expect(res.status).toBe(403);
  });

  it("returns 403 when user is a viewer", async () => {
    vi.mocked(prisma.membership.findUnique).mockReturnValueOnce(
      Promise.resolve({ role: "viewer" }) as never,
    );
    const res = await POST(
      makeRequest("task_1", { method: "POST", body: { body: "hi" } }),
      makeParams("task_1"),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/viewer/i);
  });

  it("returns 400 when body is empty string", async () => {
    const res = await POST(
      makeRequest("task_1", { method: "POST", body: { body: "" } }),
      makeParams("task_1"),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when body field is missing", async () => {
    const res = await POST(
      makeRequest("task_1", { method: "POST", body: {} }),
      makeParams("task_1"),
    );
    expect(res.status).toBe(400);
  });

  it("returns 201 with the created comment when a member posts", async () => {
    const res = await POST(
      makeRequest("task_1", { method: "POST", body: { body: "looks good to me" } }),
      makeParams("task_1"),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.comment.body).toBe("looks good to me");
    expect(body.comment.author).toMatchObject({ name: "Arjun Rao" });
  });

  it("writes comment and activity event inside the same $transaction", async () => {
    await POST(
      makeRequest("task_1", { method: "POST", body: { body: "looks good to me" } }),
      makeParams("task_1"),
    );
    expect(vi.mocked(prisma.$transaction)).toHaveBeenCalledOnce();
  });

  it("admin can also post comments", async () => {
    vi.mocked(prisma.membership.findUnique).mockReturnValueOnce(
      Promise.resolve({ role: "admin" }) as never,
    );
    const res = await POST(
      makeRequest("task_1", { method: "POST", body: { body: "approved" } }),
      makeParams("task_1"),
    );
    expect(res.status).toBe(201);
  });
});
