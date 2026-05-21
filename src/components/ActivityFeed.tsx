"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { ApiActivityEvent } from "@/types";
import { ACTIVITY_LABELS, STATUS_LABELS } from "@/types";

type Props = {
  projectId: string;
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function EventDescription({ event }: { event: ApiActivityEvent }) {
  const meta = event.meta;
  const taskTitle = event.task?.title ?? (meta.taskTitle as string | undefined);

  switch (event.type) {
    case "task_created":
      return (
        <span>
          <strong className="font-medium">{event.actor.name}</strong>{" "}
          {ACTIVITY_LABELS.task_created}{" "}
          <em className="not-italic text-white">
            {taskTitle ?? "a task"}
          </em>
        </span>
      );

    case "task_status_changed": {
      const from = meta.from as string | undefined;
      const to = meta.to as string | undefined;
      return (
        <span>
          <strong className="font-medium">{event.actor.name}</strong>{" "}
          moved{" "}
          <em className="not-italic text-white">{taskTitle ?? "a task"}</em>{" "}
          {from && to ? (
            <>
              from{" "}
              <span className="text-muted">
                {STATUS_LABELS[from as keyof typeof STATUS_LABELS] ?? from}
              </span>{" "}
              to{" "}
              <span className="text-white">
                {STATUS_LABELS[to as keyof typeof STATUS_LABELS] ?? to}
              </span>
            </>
          ) : null}
        </span>
      );
    }

    case "task_assignee_changed": {
      const to = meta.to as string | null | undefined;
      return (
        <span>
          <strong className="font-medium">{event.actor.name}</strong>{" "}
          {to ? "reassigned" : "unassigned"}{" "}
          <em className="not-italic text-white">{taskTitle ?? "a task"}</em>
        </span>
      );
    }

    case "comment_added": {
      const excerpt = meta.excerpt as string | undefined;
      return (
        <span>
          <strong className="font-medium">{event.actor.name}</strong>{" "}
          {ACTIVITY_LABELS.comment_added}{" "}
          <em className="not-italic text-white">{taskTitle ?? "a task"}</em>
          {excerpt ? (
            <span className="text-muted">
              {" "}
              — &ldquo;{excerpt.length > 80 ? excerpt.slice(0, 80) + "…" : excerpt}&rdquo;
            </span>
          ) : null}
        </span>
      );
    }

    default:
      return (
        <span>
          <strong className="font-medium">{event.actor.name}</strong>{" "}
          performed an action
        </span>
      );
  }
}

export function ActivityFeed({ projectId }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["activity", projectId],
    queryFn: () =>
      apiFetch<{ events: ApiActivityEvent[] }>(
        `/api/projects/${projectId}/activity`,
      ),
    // Refresh every 30 s so the feed stays reasonably live
    refetchInterval: 30_000,
  });

  return (
    <section aria-label="activity feed">
      <h2 className="text-sm font-medium mb-3">recent activity</h2>

      {isLoading && (
        <p className="text-xs text-muted">loading activity…</p>
      )}

      {error && (
        <p className="text-xs text-red-400">
          {error instanceof Error ? error.message : "failed to load activity"}
        </p>
      )}

      {data && data.events.length === 0 && (
        <p className="text-xs text-muted italic">no activity yet</p>
      )}

      {data && data.events.length > 0 && (
        <ol className="bg-surface border border-border rounded-lg divide-y divide-border">
          {data.events.map((ev) => (
            <li key={ev.id} className="px-4 py-3 flex items-start gap-3">
              {/* Avatar initial */}
              <span
                aria-hidden="true"
                className="mt-0.5 flex-shrink-0 w-6 h-6 rounded-full bg-accent/20 text-accent text-xs font-semibold flex items-center justify-center uppercase"
              >
                {ev.actor.name.charAt(0)}
              </span>

              <div className="flex-1 min-w-0">
                <p className="text-sm text-muted leading-snug">
                  <EventDescription event={ev} />
                </p>
              </div>

              <time
                dateTime={ev.createdAt}
                className="flex-shrink-0 text-xs text-muted mt-0.5"
              >
                {formatTime(ev.createdAt)}
              </time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
