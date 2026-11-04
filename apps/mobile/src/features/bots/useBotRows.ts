import { useAtomValue } from "@effect/atom-react";
import { deriveBotList, type BotRow } from "@t3tools/client-runtime/state/bot-list";

import { useNowMinuteMs } from "../../lib/clock";
import { useProjects } from "../../state/entities";
import { threadListEnvironmentsAtom } from "../../state/presentation";
import { environmentThreadShells } from "../../state/threads";
import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";
import { useAtomValueWhileVisible } from "../home/home-route-visibility";

/**
 * Every bot across linked environments. Quiet shells keep streaming replies from re-sorting the
 * list; `visible: false` holds the last list while a pushed screen covers it.
 */
export function useBotRows(visible = true) {
  const projects = useProjects();
  const threads = useAtomValueWhileVisible(environmentThreadShells.quietThreadShellsAtom, visible);
  const { savedConnectionsById } = useSavedRemoteConnections();
  const { machineByEnvironmentId } = useAtomValue(threadListEnvironmentsAtom);
  const now = useNowMinuteMs();
  const rows: ReadonlyArray<BotRow> = deriveBotList({
    now,
    projects,
    threads,
    machineLabels: new Map(
      Object.values(savedConnectionsById).map(
        (connection) => [connection.environmentId, connection.environmentLabel] as const,
      ),
    ),
  });
  return {
    rows,
    threads,
    machineByEnvironmentId,
    // Badges only tell bots apart when they run on more than one machine.
    showMachineBadges: new Set(rows.map((row) => row.environmentId)).size > 1,
  };
}

export type BotMachineKinds = ReturnType<typeof useBotRows>["machineByEnvironmentId"];
