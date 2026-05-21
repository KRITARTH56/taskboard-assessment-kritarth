import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getCurrentUser,
  unauthorized,
  forbidden,
  getProjectMembership,
} from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

const ACTOR_SELECT = { id: true, name: true, email: true } as const;
const TASK_SELECT = { id: true, title: true } as const;

/** GET /api/projects/:id/activity — recent activity, newest first */
export async function GET(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { id: projectId } = await params;

  const membership = await getProjectMembership(user.id, projectId);
  if (!membership) return forbidden("you are not a member of this project");

  // Default to 50 most recent events; caller can pass ?limit=N (max 200)
  const rawLimit = req.nextUrl.searchParams.get("limit");
  const limit = Math.min(200, Math.max(1, parseInt(rawLimit ?? "50", 10) || 50));

  const events = await prisma.activityEvent.findMany({
    where: { projectId },
    include: {
      actor: { select: ACTOR_SELECT },
      task: { select: TASK_SELECT },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json({ events });
}
