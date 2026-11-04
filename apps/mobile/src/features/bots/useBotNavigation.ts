import type { BotRow } from "@t3tools/client-runtime/state/bot-list";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { useNavigationState, type NavigationState } from "@react-navigation/native";

import { uuidv4 } from "../../lib/uuid";
import { useSelectWorkspaceDetail } from "../workspace/useSelectWorkspaceDetail";
import { botActivityDetail, botRowDetail } from "./bot-destinations";

/** Opens a bot's conversation, starting one when it has none, or its Activity page. */
export function useBotNavigation() {
  const selectDetail = useSelectWorkspaceDetail();
  return {
    openBot: (row: BotRow) => selectDetail(botRowDetail(row, uuidv4())),
    openActivity: (row: BotRow) => selectDetail(botActivityDetail(row)),
  };
}

const first = (value: unknown) =>
  typeof value === "string" ? value : Array.isArray(value) ? String(value[0]) : null;

// A primitive, so the list re-renders only when the open page changes.
function openPageTarget(state: NavigationState): string | null {
  const route = state.routes
    .slice(0, state.index + 1)
    .findLast((candidate) => candidate.name === "Thread" || candidate.name === "BotActivity");
  const params = (route?.params ?? {}) as Readonly<Record<string, unknown>>;
  const environmentId = first(params.environmentId);
  const id = first(route?.name === "Thread" ? params.threadId : params.projectId);
  return route && environmentId && id ? `${route.name}\n${environmentId}\n${id}` : null;
}

/** The bot whose conversation, background thread, or Activity page is open. */
export function useSelectedBotKey(
  rows: ReadonlyArray<BotRow>,
  threads: ReadonlyArray<EnvironmentThreadShell>,
): string | null {
  const target = useNavigationState(openPageTarget);
  if (target === null) return null;
  const [name, environmentId, id] = target.split("\n");
  const projectId =
    name === "BotActivity"
      ? id
      : threads.find((thread) => thread.environmentId === environmentId && thread.id === id)
          ?.projectId;
  return (
    rows.find((row) => row.environmentId === environmentId && row.projectId === projectId)?.key ??
    null
  );
}
