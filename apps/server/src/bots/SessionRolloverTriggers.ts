import type {
  OrchestrationV2ProviderTurnTokenUsage,
  OrchestrationV2ThreadProjection,
  RunId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

/**
 * Provider compaction is the first line: a session rolls over only once it has compacted and the
 * window is this full again at the end of a turn, since summaries of summaries lose more than the
 * bot's own notes do.
 */
export const CONTEXT_ROLLOVER_RATIO = 0.85;
/** A session that never reports a compaction still rolls over before the window is exhausted. */
export const CONTEXT_ROLLOVER_BACKSTOP_RATIO = 0.95;
/**
 * Four times the longest prompt cache (1h), so the next turn would pay a full uncached read of the
 * session anyway; shorter than the 6h heartbeat, so a quiet bot rolls over between heartbeats.
 */
export const IDLE_ROLLOVER_AFTER_MS = 4 * 60 * 60_000;
/** Below this a resume is cheap and keeps the working context, so an idle session stays. */
export const IDLE_ROLLOVER_MIN_TOKENS = 100_000;

export type SessionRolloverRecords = Pick<
  OrchestrationV2ThreadProjection,
  "thread" | "runs" | "messages" | "providerThreads" | "providerTurns" | "turnItems"
>;

const OPEN_RUN_STATUSES = new Set(["queued", "preparing", "starting", "running", "waiting"]);

/** The latest run that ended in the current session, when nothing runs or waits after it. */
function endedSessionRun(records: SessionRolloverRecords) {
  const { thread, runs, messages } = records;
  if (thread.archivedAt !== null || thread.deletedAt !== null) return null;
  if (thread.activeProviderThreadId === null) return null;
  if (runs.some((run) => OPEN_RUN_STATUSES.has(run.status))) return null;
  const latest = runs
    .filter((run) => run.startedAt !== null)
    .reduce<(typeof runs)[number] | null>(
      (found, run) => (found === null || run.ordinal > found.ordinal ? run : found),
      null,
    );
  if (
    latest === null ||
    latest.completedAt === null ||
    latest.providerThreadId !== thread.activeProviderThreadId
  )
    return null;
  // A rollover's own turn ends its session; its usage describes the session that is going away.
  if (messages.find((message) => message.id === latest.userMessageId)?.sessionRollover) return null;
  return latest;
}

function sessionUsage(records: SessionRolloverRecords) {
  const active = records.thread.activeProviderThreadId;
  const latest = records.providerTurns
    .filter((turn) => turn.providerThreadId === active && turn.tokenUsage !== undefined)
    .map((turn) => turn.tokenUsage!)
    .reduce<OrchestrationV2ProviderTurnTokenUsage | null>(
      (found, usage) =>
        found === null || Date.parse(usage.updatedAt) >= Date.parse(found.updatedAt)
          ? usage
          : found,
      null,
    );
  const fallback = records.providerThreads.find((thread) => thread.id === active)?.contextUsage;
  const usedTokens = latest?.usedTokens ?? fallback?.usedTokens ?? 0;
  const maxTokens = latest?.maxTokens ?? fallback?.maxTokens ?? null;
  return { usedTokens, ratio: maxTokens ? usedTokens / maxTokens : null };
}

/** The run whose end leaves the session full enough to roll over, or null. */
export function contextRolloverRun(records: SessionRolloverRecords): RunId | null {
  const run = endedSessionRun(records);
  if (run === null || run.status !== "completed") return null;
  const { ratio } = sessionUsage(records);
  if (ratio === null || ratio < CONTEXT_ROLLOVER_RATIO) return null;
  const compacted = records.turnItems.some(
    (item) =>
      item.type === "compaction" &&
      item.status === "completed" &&
      item.providerThreadId === records.thread.activeProviderThreadId,
  );
  return compacted || ratio >= CONTEXT_ROLLOVER_BACKSTOP_RATIO ? run.id : null;
}

/** When an idle session should roll over, keyed by the run it went idle after, or null. */
export function idleRollover(
  records: SessionRolloverRecords,
): { readonly runId: RunId; readonly atMs: number } | null {
  const run = endedSessionRun(records);
  if (run === null || run.completedAt === null) return null;
  if (sessionUsage(records).usedTokens < IDLE_ROLLOVER_MIN_TOKENS) return null;
  return { runId: run.id, atMs: DateTime.toEpochMillis(run.completedAt) + IDLE_ROLLOVER_AFTER_MS };
}
