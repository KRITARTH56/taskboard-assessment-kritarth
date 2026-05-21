/**
 * Tests for GET /api/projects/:id/activity
 *
 * Covers:
 * - 401 when unauthenticated
 * - 403 when user is not a project member
 * - 200 + events array for any member (including viewers)
 * - Events are queried newest-first
 * - limit query param is respected (capped at 200)
 * - Query is scoped to the requested project
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── JWT mock ──────────────────────────────────────────────────────────────────
vi.mock("@/lib/jwt", () => ({
  verifyToken: vi.fn(() => ({ userId: "user_admin", email: "admin@test.com" })),
}));

// ── Prisma mock ───────────────────────────────────────────────────────────────
vi.mock("@/lib/prisma", () => {
  const mockEvent = {
    id: "evt_1",
    projectId: "proj_1",
    actorId: "user_admin",
    taskId: "task_1",
    commentId: null,
    type: "task_created",
    meta: { title: "New task", status: "todo" },
    createdAt: new Date("2026-05-21T12:00:00Z"),
    actor: { id: "user_admin", name: "Meera Iyer", email: "admin@test.com" },
    task: { id: "task_1", title: "New task" },
  };

  return {
    prisma: {
      user: {
        findUnique: vi.fn(() =>
          Promise.resolve({ id: "user_admin", email: "admin@test.com", name: "Meera Iyer" }),
        ),
      },
      membership: {
        findUnique: vi.fn(() => Promise.resolve({ role: "admin" })),
      },
      activityEvent: {
        findMany: vi.fn(() => Promise.resolve([mockEvent])),
      },
    },
  };
});

import { GET } from "@/app/api/projects/[id]/activity/route";
import { prisma } from "@/lib/prisma";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeRequest(
  projectId: string,
  options: { auth?: string | null; search?: string } = {},
): NextRequest {
  const { auth = "Bearer valid.token", search = "" } = options;
  const url = `http://localhost/api/projects/${projectId}/activity${search}`;
  const headers: Record<string, string> = {};
  if (auth) headers["Authorization"] = auth;
  return new NextRequest(url, { headers });
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/projects/:id/activity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.user.findUnique).mockReturnValue(
      Promise.resolve({ id: "user_admin", email: "admin@test.com", name: "Meera Iyer" }) as never,
    );
    vi.mocked(prisma.membership.findUnique).mockReturnValue(
      Promise.resolve({ role: "admin" }) as never,
    );
  });

  it("returns 401 when no auth header is provided", async () => {
    const res = await GET(makeRequest("proj_1", { auth: null }), makeParams("proj_1"));
    expect(res.status).toBe(401);
  });

  it("returns 403 when user is not a project member", async () => {
    vi.mocked(prisma.membership.findUnique).mockReturnValueOnce(Promise.resolve(null) as never);
    const res = await GET(makeRequest("proj_1"), makeParams("proj_1"));
    expect(res.status).toBe(403);
  });

  it("returns 200 with events array for a project member", async () => {
    const res = await GET(makeRequest("proj_1"), makeParams("proj_1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.events)).toBe(true);
  });

  it("viewers can read the activity feed", async () => {
    vi.mocked(prisma.membership.findUnique).mockReturnValueOnce(
      Promise.resolve({ role: "viewer" }) as never,
    );
    const res = await GET(makeRequest("proj_1"), makeParams("proj_1"));
    expect(res.status).toBe(200);
  });

  it("returns events with actor, type, and createdAt", async () => {
    const res = await GET(makeRequest("proj_1"), makeParams("proj_1"));
    const body = await res.json();
    const ev = body.events[0];
    expect(ev.type).toBe("task_created");
    expect(ev.actor).toMatchObject({ name: "Meera Iyer" });
    expect(ev.createdAt).toBeDefined();
  });

  it("queries Prisma with orderBy createdAt desc (newest first)", async () => {
    await GET(makeRequest("proj_1"), makeParams("proj_1"));
    const call = vi.mocked(prisma.activityEvent.findMany).mock.calls.at(-1)?.[0];
    expect(call?.orderBy).toMatchObject({ createdAt: "desc" });
  });

  it("defaults to a limit of 50", async () => {
    await GET(makeRequest("proj_1"), makeParams("proj_1"));
    const call = vi.mocked(prisma.activityEvent.findMany).mock.calls.at(-1)?.[0];
    expect(call?.take).toBe(50);
  });

  it("respects a custom ?limit param", async () => {
    await GET(makeRequest("proj_1", { search: "?limit=10" }), makeParams("proj_1"));
    const call = vi.mocked(prisma.activityEvent.findMany).mock.calls.at(-1)?.[0];
    expect(call?.take).toBe(10);
  });

  it("caps limit at 200", async () => {
    await GET(makeRequest("proj_1", { search: "?limit=9999" }), makeParams("proj_1"));
    const call = vi.mocked(prisma.activityEvent.findMany).mock.calls.at(-1)?.[0];
    expect(call?.take).toBe(200);
  });

  it("scopes the query to the requested project", async () => {
    await GET(makeRequest("proj_1"), makeParams("proj_1"));
    const call = vi.mocked(prisma.activityEvent.findMany).mock.calls.at(-1)?.[0];
    expect(call?.where).toMatchObject({ projectId: "proj_1" });
  });
});
