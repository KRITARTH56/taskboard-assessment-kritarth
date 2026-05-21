import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getCurrentUser,
  unauthorized,
  forbidden,
  notFound,
  badRequest,
  getProjectMembership,
  canEditTasks,
} from "@/lib/auth";
import { createCommentSchema } from "@/schemas/comment";
import { recordActivity } from "@/lib/activity";

type Params = { params: Promise<{ id: string }> };

const AUTHOR_SELECT = { id: true, name: true, email: true } as const;

/** GET /api/tasks/:id/comments — list comments chronologically */
export async function GET(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { id: taskId } = await params;

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { projectId: true },
  });
  if (!task) return notFound("task not found");

  const membership = await getProjectMembership(user.id, task.projectId);
  if (!membership) return forbidden("you are not a member of this project");

  const comments = await prisma.comment.findMany({
    where: { taskId },
    include: { author: { select: AUTHOR_SELECT } },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ comments });
}

/** POST /api/tasks/:id/comments — post a new comment (members + admins only) */
export async function POST(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { id: taskId } = await params;

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { projectId: true, title: true },
  });
  if (!task) return notFound("task not found");

  const membership = await getProjectMembership(user.id, task.projectId);
  if (!membership) return forbidden("you are not a member of this project");
  if (!canEditTasks(membership.role)) {
    return forbidden("viewers cannot post comments");
  }

  const body = await req.json().catch(() => null);
  const parsed = createCommentSchema.safeParse(body);
  if (!parsed.success) return badRequest("invalid input", parsed.error.flatten());

  const comment = await prisma.$transaction(async (tx) => {
    const created = await tx.comment.create({
      data: {
        taskId,
        projectId: task.projectId,
        authorId: user.id,
        body: parsed.data.body,
      },
      include: { author: { select: AUTHOR_SELECT } },
    });

    await recordActivity({
      tx,
      projectId: task.projectId,
      actorId: user.id,
      type: "comment_added",
      taskId,
      commentId: created.id,
      meta: { taskTitle: task.title, excerpt: parsed.data.body.slice(0, 120) },
    });

    return created;
  });

  return NextResponse.json({ comment }, { status: 201 });
}
