/**
 * Real Airtable integration using the official `airtable` npm package.
 *
 * This module is the production implementation. Unit tests should import
 * from `@/lib/airtable-mock` instead and never touch this file.
 *
 * Environment variables required:
 *   AIRTABLE_API_KEY    — Personal Access Token from airtable.com/create/tokens
 *   AIRTABLE_BASE_ID    — The base ID (starts with "app…")
 *   AIRTABLE_TABLE_NAME — Table name, defaults to "Tasks"
 *
 * Idempotency strategy
 * --------------------
 * Each task is pushed with a "TaskBoard ID" field set to the task's UUID.
 * Before writing, we query Airtable for existing records that match any of
 * the task IDs in the batch. Matches are updated; non-matches are created.
 * Running the export twice produces the same set of records.
 *
 * Error handling
 * --------------
 * Transient errors (HTTP 429, 5xx, network failures) are retried up to
 * MAX_RETRIES times with exponential back-off + jitter.
 * Permanent errors (HTTP 4xx except 429) are not retried — the batch is
 * recorded as failed and the export continues with the next batch.
 */

import Airtable from "airtable";
import type { FieldSet } from "airtable";

// ── Config ────────────────────────────────────────────────────────────────────

const API_KEY = process.env.AIRTABLE_API_KEY;
const BASE_ID = process.env.AIRTABLE_BASE_ID;
const TABLE_NAME = process.env.AIRTABLE_TABLE_NAME ?? "Tasks";

/** Maximum records per Airtable batch create/update call (API limit: 10). */
const BATCH_SIZE = 10;

/** Maximum retry attempts for transient failures. */
const MAX_RETRIES = 3;

/** Base delay in ms for exponential back-off. */
const BASE_DELAY_MS = 1_000;

// ── Types ─────────────────────────────────────────────────────────────────────

export type TaskExportRecord = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  assigneeName: string | null;
  createdById: string;
  position: number;
  createdAt: string;
  updatedAt: string;
};

export type ExportResult = {
  /** Number of records successfully created in Airtable. */
  created: number;
  /** Number of records successfully updated in Airtable. */
  updated: number;
  /** Number of records that failed after all retries. */
  failed: number;
  /** Human-readable error summaries for failed records. */
  errors: string[];
};

type TaskFields = FieldSet & {
  "TaskBoard ID": string;
  Title: string;
  Description: string;
  Status: string;
  Assignee: string;
  Position: number;
  "Created At": string;
  "Updated At": string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function isTransient(err: unknown): boolean {
  if (err instanceof Airtable.Error) {
    return err.statusCode === 429 || err.statusCode >= 500;
  }
  // Network-level errors (no statusCode) are also transient
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(base: number): number {
  // Full jitter: random value in [0, base]
  return Math.random() * base;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isTransient(err)) {
        // Permanent failure — don't retry
        throw err;
      }
      if (attempt < MAX_RETRIES) {
        const delay = jitter(BASE_DELAY_MS * Math.pow(2, attempt - 1));
        console.warn(
          `[airtable] transient error on ${label} (attempt ${attempt}/${MAX_RETRIES}), ` +
            `retrying in ${Math.round(delay)}ms: ${String(err)}`,
        );
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

function toFields(task: TaskExportRecord): TaskFields {
  return {
    "TaskBoard ID": task.id,
    Title: task.title,
    Description: task.description ?? "",
    Status: task.status,
    Assignee: task.assigneeName ?? "unassigned",
    Position: task.position,
    "Created At": task.createdAt,
    "Updated At": task.updatedAt,
  };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// ── Main export function ──────────────────────────────────────────────────────

/**
 * Export all tasks to Airtable.
 *
 * @throws {Error} if AIRTABLE_API_KEY or AIRTABLE_BASE_ID are not configured.
 */
export async function exportTasksToAirtable(
  tasks: TaskExportRecord[],
): Promise<ExportResult> {
  if (!API_KEY || !BASE_ID) {
    throw new Error(
      "Airtable is not configured. Set AIRTABLE_API_KEY and AIRTABLE_BASE_ID in your environment.",
    );
  }

  const airtable = new Airtable({ apiKey: API_KEY });
  const table = airtable.base(BASE_ID)<TaskFields>(TABLE_NAME);

  const result: ExportResult = { created: 0, updated: 0, failed: 0, errors: [] };

  if (tasks.length === 0) return result;

  // ── Step 1: Find existing records by TaskBoard ID ─────────────────────────
  // We query in batches of 100 (Airtable formula length limit is generous but
  // we stay conservative). The OR formula matches any of the task IDs.
  const taskIds = tasks.map((t) => t.id);
  const existingIdMap = new Map<string, string>(); // taskboardId → airtableRecordId

  const idBatches = chunk(taskIds, 100);
  for (const idBatch of idBatches) {
    try {
      const formula =
        idBatch.length === 1
          ? `{TaskBoard ID} = "${idBatch[0]}"`
          : `OR(${idBatch.map((id) => `{TaskBoard ID} = "${id}"`).join(",")})`;

      await withRetry(async () => {
        const records = await table
          .select({ filterByFormula: formula, fields: ["TaskBoard ID"] })
          .all();
        for (const rec of records) {
          const tbId = rec.get("TaskBoard ID");
          if (typeof tbId === "string") {
            existingIdMap.set(tbId, rec.id);
          }
        }
      }, "select existing records");
    } catch (err) {
      // If we can't look up existing records, we'll fall back to creating all
      // of them. This may produce duplicates on re-run but is better than
      // aborting the entire export.
      console.error("[airtable] failed to query existing records:", err);
    }
  }

  // ── Step 2: Split tasks into creates and updates ──────────────────────────
  const toCreate: TaskExportRecord[] = [];
  const toUpdate: Array<{ airtableId: string; task: TaskExportRecord }> = [];

  for (const task of tasks) {
    const airtableId = existingIdMap.get(task.id);
    if (airtableId) {
      toUpdate.push({ airtableId, task });
    } else {
      toCreate.push(task);
    }
  }

  // ── Step 3: Batch create new records ─────────────────────────────────────
  for (const batch of chunk(toCreate, BATCH_SIZE)) {
    try {
      await withRetry(async () => {
        const records = await table.create(
          batch.map((t) => ({ fields: toFields(t) })),
        );
        result.created += records.length;
      }, `create batch of ${batch.length}`);
    } catch (err) {
      result.failed += batch.length;
      result.errors.push(
        `create batch failed (${batch.length} records): ${String(err)}`,
      );
    }
  }

  // ── Step 4: Batch update existing records ─────────────────────────────────
  for (const batch of chunk(toUpdate, BATCH_SIZE)) {
    try {
      await withRetry(async () => {
        const records = await table.update(
          batch.map(({ airtableId, task }) => ({
            id: airtableId,
            fields: toFields(task),
          })),
        );
        result.updated += records.length;
      }, `update batch of ${batch.length}`);
    } catch (err) {
      result.failed += batch.length;
      result.errors.push(
        `update batch failed (${batch.length} records): ${String(err)}`,
      );
    }
  }

  return result;
}
