import type { BotRow } from "@t3tools/client-runtime/state/bot-list";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useEffect } from "react";

import { appAtomRegistry } from "../../state/atom-registry";
import { environmentThreads } from "../../state/threads";

/**
 * Keeps each listed bot's conversation in memory from its stored copy, so tapping a bot shows
 * the conversation on its first frame instead of after a storage read.
 */
export function useWarmBotThreads(rows: ReadonlyArray<BotRow>) {
  const refs = rows
    .flatMap((row) =>
      row.mainThreadId === null ? [] : [`${row.environmentId}\t${row.mainThreadId}`],
    )
    .join("\n");
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- holds the warm-cache atoms in the app registry while their bots are listed
  useEffect(() => {
    if (refs === "") return;
    const releases = refs.split("\n").map((ref) => {
      const [environmentId = "", threadId = ""] = ref.split("\t");
      return appAtomRegistry.mount(
        environmentThreads.warmAtom(EnvironmentId.make(environmentId), ThreadId.make(threadId)),
      );
    });
    return () => releases.forEach((release) => release());
  }, [refs]);
}
