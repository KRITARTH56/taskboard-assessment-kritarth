import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getCurrentUser,
  unauthorized,
  forbidden,
  getProjectMembership,
  canEditTasks,
} from "@/lib/auth";
import { exportTasksToAirtable } from "@/lib/airtable-client";
import type { TaskExportRecord } from "@/lib/airtable-client";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/projects/:id/export
 *
 * Exports all tasks for the project to Airtable.
 * Only admins and members can trigger an export; viewers get 403.
 *
 * Response shape:
 *   { created, updated, failed, errors, total }
 */
export async function POST(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { id: projectId } = await params;

  const membership = await getProjectMembership(user.id, projectId);
  if (!membership) return forbidden("you are not a member of this project");
  if (!canEditTasks(membership.role)) {
    return forbidden("viewers cannot export tasks");
  }

  // Fetch all tasks with their assignee names
  const tasks = await prisma.task.findMany({
    where: { projectId },
    include: {
      assignee: { select: { name: true } },
    },
    orderBy: [{ status: "asc" }, { position: "asc" }],
  });

  const exportRecords: TaskExportRecord[] = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status,
    assigneeName: t.assignee?.name ?? null,
    createdById: t.createdById,
    position: t.position,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  }));

  try {
    const result = await exportTasksToAirtable(exportRecords);
    return NextResponse.json({
      ...result,
      total: tasks.length,
    });
  } catch (err) {
    // Configuration errors (missing API key / base ID) surface as 503
    const message = err instanceof Error ? err.message : "export failed";
    const isConfig = message.includes("not configured");
    return NextResponse.json(
      { error: message },
      { status: isConfig ? 503 : 500 },
    );
  }
}
