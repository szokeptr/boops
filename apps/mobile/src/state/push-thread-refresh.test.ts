import type { EnvironmentThreadStatus } from "@t3tools/client-runtime/state/threads";
import { describe, expect, it } from "vite-plus/test";

import { advancePushThreadRefresh, PUSH_THREAD_REFRESH_START } from "./push-thread-refresh";

type Step = readonly [EnvironmentThreadStatus, number];

function settlesAt(steps: ReadonlyArray<Step>): number | null {
  let progress = PUSH_THREAD_REFRESH_START;
  for (const [index, [status, sequence]] of steps.entries()) {
    progress = advancePushThreadRefresh(progress, { status, sequence });
    if (progress.phase === "done") return index;
  }
  return null;
}

describe("advancePushThreadRefresh", () => {
  it.each<{ name: string; steps: ReadonlyArray<Step>; settlesAt: number | null }>([
    {
      name: "a stored copy once it syncs",
      steps: [
        ["empty", 0],
        ["cached", 4],
        ["synchronizing", 4],
        ["live", 6],
      ],
      settlesAt: 3,
    },
    {
      name: "a thread never loaded once it syncs",
      steps: [
        ["empty", 0],
        ["synchronizing", 0],
        ["live", 6],
      ],
      settlesAt: 2,
    },
    {
      name: "a resumed live copy only once a newer event lands",
      steps: [
        ["empty", 0],
        ["live", 4],
        ["live", 4],
        ["live", 5],
      ],
      settlesAt: 3,
    },
    {
      name: "a mounted live thread once it resyncs",
      steps: [
        ["live", 4],
        ["synchronizing", 4],
        ["live", 4],
      ],
      settlesAt: 2,
    },
    {
      name: "a deleted thread",
      steps: [
        ["empty", 0],
        ["deleted", 0],
      ],
      settlesAt: 1,
    },
    {
      name: "never, while still empty",
      steps: [
        ["empty", 0],
        ["empty", 0],
      ],
      settlesAt: null,
    },
  ])("settles $name", ({ steps, settlesAt: expected }) => {
    expect(settlesAt(steps)).toBe(expected);
  });
});
