import type { BotRow } from "@t3tools/client-runtime/state/bot-list";

import type { WorkspaceDetail } from "../workspace/workspace-detail-selection";

/** What tapping a bot opens: its main thread, or a new conversation when it has none yet. */
export function botRowDetail(
  row: Pick<BotRow, "environmentId" | "projectId" | "name" | "mainThreadId">,
  requestId: string,
): WorkspaceDetail {
  return row.mainThreadId === null
    ? {
        name: "Thread",
        params: {
          draft: {
            requestId,
            environmentId: String(row.environmentId),
            projectId: String(row.projectId),
            title: row.name,
          },
        },
      }
    : {
        name: "Thread",
        params: { environmentId: String(row.environmentId), threadId: String(row.mainThreadId) },
      };
}

export function botActivityDetail(
  row: Pick<BotRow, "environmentId" | "projectId">,
): WorkspaceDetail {
  return {
    name: "BotActivity",
    params: { environmentId: String(row.environmentId), projectId: String(row.projectId) },
  };
}
