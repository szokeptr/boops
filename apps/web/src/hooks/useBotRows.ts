import { deriveBotList, type BotRow } from "@t3tools/client-runtime/state/bot-list";

import { useNowMinute } from "./useNowMinute";
import { useProjects, useQuietThreadShells } from "../state/entities";
import { useEnvironmentIdentities } from "../state/environments";
import { useUiStateStore } from "../uiStateStore";

/** Every bot across linked environments; quiet shells keep streaming replies from re-sorting it. */
export function useBotRows(): ReadonlyArray<BotRow> {
  const projects = useProjects();
  const threads = useQuietThreadShells();
  const identities = useEnvironmentIdentities();
  const localLastVisitedAt = useUiStateStore((state) => state.threadLastVisitedAtById);
  // Dozing only needs minute precision.
  const nowMinute = useNowMinute();
  return deriveBotList({
    now: Date.parse(`${nowMinute}:00.000Z`),
    projects,
    threads,
    machineLabels: new Map(identities.map((identity) => [identity.environmentId, identity.label])),
    localLastVisitedAt,
  });
}
