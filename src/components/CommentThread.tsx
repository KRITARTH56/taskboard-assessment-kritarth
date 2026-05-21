"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { ApiComment, Role } from "@/types";

type Props = {
  taskId: string;
  /** The current user's role in this project — viewers can read but not post */
  userRole: Role;
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

export function CommentThread({ taskId, userRole }: Props) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["comments", taskId],
    queryFn: () =>
      apiFetch<{ comments: ApiComment[] }>(`/api/tasks/${taskId}/comments`),
  });

  const postComment = useMutation({
    mutationFn: (text: string) =>
      apiFetch<{ comment: ApiComment }>(`/api/tasks/${taskId}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: text }),
      }),
    onSuccess: () => {
      setBody("");
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["comments", taskId] });
    },
    onError: (err) =>
      setError(err instanceof Error ? err.message : "failed to post comment"),
  });

  const canComment = userRole === "admin" || userRole === "member";

  return (
    <section aria-label="comments">
      <h3 className="text-xs font-medium text-muted uppercase tracking-wide mb-3">
        Comments
      </h3>

      {isLoading && (
        <p className="text-xs text-muted">loading comments…</p>
      )}

      {data && data.comments.length === 0 && (
        <p className="text-xs text-muted italic">no comments yet</p>
      )}

      {data && data.comments.length > 0 && (
        <ul className="space-y-3 mb-4">
          {data.comments.map((c) => (
            <li
              key={c.id}
              className="bg-bg border border-border rounded-md px-3 py-2"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium">{c.author.name}</span>
                <time
                  dateTime={c.createdAt}
                  className="text-xs text-muted"
                >
                  {formatTime(c.createdAt)}
                </time>
              </div>
              <p className="text-sm whitespace-pre-wrap break-words">{c.body}</p>
            </li>
          ))}
        </ul>
      )}

      {canComment && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!body.trim()) return;
            setError(null);
            postComment.mutate(body.trim());
          }}
        >
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="add a comment…"
            rows={3}
            aria-label="new comment"
            className="w-full rounded-md bg-bg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none resize-none"
          />
          {error && (
            <p className="text-xs text-red-400 mt-1" role="alert">
              {error}
            </p>
          )}
          <div className="flex justify-end mt-2">
            <button
              type="submit"
              disabled={postComment.isPending || !body.trim()}
              className="text-sm px-4 py-1.5 rounded-md bg-accent text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {postComment.isPending ? "posting…" : "post"}
            </button>
          </div>
        </form>
      )}

      {!canComment && (
        <p className="text-xs text-muted italic">
          viewers can read comments but cannot post.
        </p>
      )}
    </section>
  );
}
