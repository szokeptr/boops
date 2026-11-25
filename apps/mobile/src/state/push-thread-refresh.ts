import type { EnvironmentThreadState } from "@t3tools/client-runtime/state/threads";

/** How far a thread held open after its push has got towards holding the pushed reply. */
export type PushThreadRefresh =
  | { readonly phase: "waiting" }
  | { readonly phase: "stale"; readonly sequence: number }
  | { readonly phase: "syncing" }
  | { readonly phase: "done" };

export const PUSH_THREAD_REFRESH_START: PushThreadRefresh = { phase: "waiting" };

const SYNCING: PushThreadRefresh = { phase: "syncing" };
const DONE: PushThreadRefresh = { phase: "done" };

export function advancePushThreadRefresh(
  progress: PushThreadRefresh,
  state: Pick<EnvironmentThreadState, "status" | "sequence">,
): PushThreadRefresh {
  if (progress.phase === "done" || state.status === "empty") return progress;
  if (state.status === "deleted") return DONE;
  if (state.status !== "live") return SYNCING;
  // A thread already live in memory can predate the push until a newer event or a resync lands.
  if (progress.phase === "waiting") return { phase: "stale", sequence: state.sequence };
  if (progress.phase === "stale" && state.sequence === progress.sequence) return progress;
  return DONE;
}
