import type { OrchestrationV2ThreadShell, ScopedThreadRef } from "@t3tools/contracts";

import { useRightPanelStore } from "../rightPanelStore";

/** Whether an event started in the side chat pane (`data-side-chat-pane`), which the main chat ignores. */
export function isInSideChatPane(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[data-side-chat-pane]") !== null;
}

/**
 * Runs an embedded side chat's shell commands in the parent's terminal drawer, since the embedded
 * view hides its own. Panel actions reach the parent through `hostRightPanel`; the drawer is not
 * panel state.
 */
export interface SideChatParentPanel {
  readonly runShellCommand: (command: string) => void;
}

/** Opens `thread` in its tab when it is a side chat of `parentRef`; false for any other thread. */
export function openSideChatTab(
  parentRef: ScopedThreadRef,
  thread: Pick<OrchestrationV2ThreadShell, "id" | "lineage"> | null,
): boolean {
  if (thread?.lineage.sideChat !== true || thread.lineage.parentThreadId !== parentRef.threadId) {
    return false;
  }
  useRightPanelStore.getState().openSideChat(parentRef, thread.id);
  return true;
}
