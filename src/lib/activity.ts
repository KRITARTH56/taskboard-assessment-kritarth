/**
 * Helpers for writing ActivityEvent rows.
 *
 * All writes are done inside the caller's Prisma transaction so that the
 * activity record and the primary change are committed atomically. If the
 * activity write fails the whole transaction rolls back — a change with no
 * audit record is worse than a failed operation the user can retry.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import type { ActivityEventType } from "@/types";

type TxClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

type RecordActivityInput = {
  tx: TxClient;
  projectId: string;
  actorId: string;
  type: ActivityEventType;
  taskId?: string;
  commentId?: string;
  meta?: Record<string, unknown>;
};

export async function recordActivity({
  tx,
  projectId,
  actorId,
  type,
  taskId,
  commentId,
  meta = {},
}: RecordActivityInput) {
  return tx.activityEvent.create({
    data: {
      projectId,
      actorId,
      type,
      taskId: taskId ?? null,
      commentId: commentId ?? null,
      meta: meta as Prisma.InputJsonValue,
    },
  });
}
