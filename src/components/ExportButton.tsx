"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";

type ExportResponse = {
  total: number;
  created: number;
  updated: number;
  failed: number;
  errors: string[];
};

type Props = {
  projectId: string;
};

type ExportState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; result: ExportResponse }
  | { status: "error"; message: string };

export function ExportButton({ projectId }: Props) {
  const [state, setState] = useState<ExportState>({ status: "idle" });

  async function handleExport() {
    setState({ status: "loading" });
    try {
      const result = await apiFetch<ExportResponse>(
        `/api/projects/${projectId}/export`,
        { method: "POST" },
      );
      setState({ status: "success", result });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "export failed",
      });
    }
  }

  const isLoading = state.status === "loading";

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        onClick={handleExport}
        disabled={isLoading}
        className="flex items-center gap-2 text-sm px-4 py-2 rounded-md border border-border hover:border-accent hover:text-accent transition disabled:opacity-50"
        aria-label="Export tasks to Airtable"
      >
        {isLoading ? (
          <>
            <span
              className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin"
              aria-hidden="true"
            />
            exporting…
          </>
        ) : (
          <>
            {/* Airtable-style grid icon */}
            <svg
              aria-hidden="true"
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              className="flex-shrink-0"
            >
              <rect x="0" y="0" width="6" height="6" rx="1" fill="currentColor" opacity="0.9" />
              <rect x="8" y="0" width="6" height="6" rx="1" fill="currentColor" opacity="0.6" />
              <rect x="0" y="8" width="6" height="6" rx="1" fill="currentColor" opacity="0.6" />
              <rect x="8" y="8" width="6" height="6" rx="1" fill="currentColor" opacity="0.3" />
            </svg>
            export to Airtable
          </>
        )}
      </button>

      {state.status === "success" && (
        <div
          role="status"
          aria-live="polite"
          className="text-xs text-right"
        >
          <p className="text-green-400">
            ✓ exported {state.result.total} task
            {state.result.total !== 1 ? "s" : ""} —{" "}
            {state.result.created} created, {state.result.updated} updated
            {state.result.failed > 0 && (
              <span className="text-yellow-400">
                , {state.result.failed} failed
              </span>
            )}
          </p>
          {state.result.errors.length > 0 && (
            <ul className="mt-1 text-yellow-400 text-left max-w-xs">
              {state.result.errors.map((e, i) => (
                <li key={i} className="truncate" title={e}>
                  · {e}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {state.status === "error" && (
        <p
          role="alert"
          className="text-xs text-red-400 text-right max-w-xs"
        >
          {state.message}
        </p>
      )}
    </div>
  );
}
