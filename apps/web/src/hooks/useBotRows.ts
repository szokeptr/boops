import { deriveBotList, type BotRow } from "@t3tools/client-runtime/state/bot-list";

import { useProjects, useQuietThreadShells } from "../state/entities";
import { useEnvironmentIdentities } from "../state/environments";
import { useUiStateStore } from "../uiStateStore";

/** Every bot across linked environments; quiet shells keep streaming replies from re-sorting it. */
export function useBotRows(): ReadonlyArray<BotRow> {
  const projects = useProjects();
  const threads = useQuietThreadShells();
  const identities = useEnvironmentIdentities();
  const localLastVisitedAt = useUiStateStore((state) => state.threadLastVisitedAtById);
  return deriveBotList({
    projects,
    threads,
    machineLabels: new Map(identities.map((identity) => [identity.environmentId, identity.label])),
    localLastVisitedAt,
  });
}
