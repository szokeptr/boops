import { useAtomValue } from "@effect/atom-react";
import { splitPinnedBots, type BotRow } from "@t3tools/client-runtime/state/bot-list";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { useParams, useRouter } from "@tanstack/react-router";
import { PlusIcon, SearchIcon } from "lucide-react";
import { useEffect, type MouseEvent, type ReactNode } from "react";

import { isCommandPaletteOpen, openCommandPalette } from "../../commandPaletteBus";
import { openCreateBotDialog } from "../CreateBotDialog";
import { isElectron } from "../../env";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useProjectPin } from "../../hooks/useProjectGroupUpdate";
import { readLocalApi } from "../../localApi";
import { useBotRows } from "../../hooks/useBotRows";
import { useTerminalFocus } from "../../hooks/useTerminalFocus";
import {
  resolveShortcutCommand,
  shortcutLabelForCommand,
  shouldShowThreadJumpHintsForModifiers,
  threadJumpCommandForIndex,
  threadJumpIndexFromCommand,
  threadTraversalDirectionFromCommand,
} from "../../keybindings";
import { isTerminalFocused } from "../../lib/terminalFocus";
import { isModelPickerOpen } from "../../modelPickerVisibility";
import { useShortcutModifierState } from "../../shortcutModifierState";
import { useQuietThreadShell } from "../../state/entities";
import { useEnvironmentMachines } from "../../state/environments";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { buildThreadRouteParams } from "../../threadRoutes";
import { useThreadRouteRef } from "../../hooks/useThreadRouteTarget";
import { resolveAdjacentThreadId, useThreadJumpHintsVisible } from "../Sidebar.logic";
import { Button } from "../ui/button";
import { SidebarChromeFooter, SidebarChromeHeader } from "../sidebar/SidebarChrome";
import { SidebarContent, SidebarGroup, useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ArchivedBotList } from "./ArchivedBotList";
import { BotList } from "./BotList";

/** The bot whose main thread, background thread, or activity page the route shows. */
function useActiveBotKey(): string | null {
  const routeThreadRef = useThreadRouteRef();
  const routeThread = useQuietThreadShell(routeThreadRef);
  const activityEnvironmentId = useParams({
    strict: false,
    select: (params) => params.environmentId,
  });
  const activityProjectId = useParams({ strict: false, select: (params) => params.projectId });
  if (routeThread !== null) return `${routeThread.environmentId}:${routeThread.projectId}`;
  if (activityEnvironmentId && activityProjectId) {
    return `${activityEnvironmentId}:${activityProjectId}`;
  }
  return null;
}

/** Opens a bot's conversation, starting one when the bot has none yet. */
function useOpenBot() {
  const router = useRouter();
  const handleNewThread = useNewThreadHandler();
  return (row: BotRow) => {
    if (row.mainThreadId === null) {
      return handleNewThread(scopeProjectRef(row.environmentId, row.projectId));
    }
    return router.navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams({
        environmentId: row.environmentId,
        threadId: row.mainThreadId,
      }),
    });
  };
}

/** Right-click on a bot: pin or unpin it, or open its activity. */
function useBotContextMenu(onNavigate: (() => void) | undefined) {
  const router = useRouter();
  const { canPinProjectGroup, setProjectGroupPinned } = useProjectPin();
  return async (row: BotRow, event: MouseEvent) => {
    const api = readLocalApi();
    if (!api) return;
    event.preventDefault();
    const group = {
      memberProjects: [
        { environmentId: row.environmentId, id: row.projectId, environmentLabel: row.machineLabel },
      ],
      pinned: row.pinnedAt !== null,
    };
    const items: Array<{ id: "pin" | "activity"; label: string; disabled?: boolean }> = [
      { id: "pin", label: group.pinned ? "Unpin" : "Pin", disabled: !canPinProjectGroup(group) },
    ];
    if (row.activityThreadCount > 0) {
      items.push({ id: "activity", label: `Activity (${row.activityThreadCount})` });
    }
    const action = await api.contextMenu.show(items, { x: event.clientX, y: event.clientY });
    if (action === "pin") setProjectGroupPinned(group, !group.pinned);
    if (action === "activity") {
      onNavigate?.();
      void router.navigate({
        to: "/bots/$environmentId/$projectId/activity",
        params: { environmentId: row.environmentId, projectId: row.projectId },
      });
    }
  };
}

export function BotListPanel({ onNavigate }: { readonly onNavigate?: () => void }) {
  const { pinned, unpinned } = splitPinnedBots(useBotRows());
  // Jump shortcuts and next/previous follow the order shown: pins first.
  const rows = [...pinned, ...unpinned];
  const showBotContextMenu = useBotContextMenu(onNavigate);
  const activeKey = useActiveBotKey();
  const machineKindById = useEnvironmentMachines();
  const openBot = useOpenBot();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const shortcutModifiers = useShortcutModifierState();
  const terminalFocused = useTerminalFocus();
  const shortcutContext = {
    terminalFocus: terminalFocused,
    modelPickerOpen: isModelPickerOpen(),
    isWeb: !isElectron,
    isDesktop: isElectron,
  };
  const showJumpHints = useThreadJumpHintsVisible(
    shouldShowThreadJumpHintsForModifiers(shortcutModifiers, keybindings, {
      platform: navigator.platform,
      context: shortcutContext,
    }),
  );
  const jumpLabelByKey = new Map<string, string>();
  if (showJumpHints) {
    for (const [index, row] of rows.entries()) {
      const label = shortcutLabelForCommand(keybindings, threadJumpCommandForIndex(index), {
        platform: navigator.platform,
        context: shortcutContext,
      });
      if (label === null) break;
      jumpLabelByKey.set(row.key, label);
    }
  }

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- window keydown listener for bot jump and next/previous shortcuts over the current list
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || isCommandPaletteOpen() || isModelPickerOpen()) {
        return;
      }
      const command = resolveShortcutCommand(event, keybindings, {
        platform: navigator.platform,
        context: {
          terminalFocus: isTerminalFocused(),
          modelPickerOpen: isModelPickerOpen(),
          isWeb: !isElectron,
          isDesktop: isElectron,
        },
      });
      const direction = threadTraversalDirectionFromCommand(command);
      const targetKey =
        direction !== null
          ? resolveAdjacentThreadId({
              threadIds: rows.map((row) => row.key),
              currentThreadId: activeKey,
              direction,
            })
          : (rows[threadJumpIndexFromCommand(command ?? "") ?? -1]?.key ?? null);
      const target = rows.find((row) => row.key === targetKey);
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      onNavigate?.();
      void openBot(target);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeKey, keybindings, onNavigate, openBot, rows]);

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-2 py-6 text-center text-xs text-sidebar-muted-foreground">
        <span>No bots yet</span>
        <AddBotButton />
      </div>
    );
  }
  return (
    <BotList
      pinnedRows={pinned}
      rows={unpinned}
      activeKey={activeKey}
      showMachineBadges={new Set(rows.map((row) => row.environmentId)).size > 1}
      machineKindById={machineKindById}
      jumpLabelByKey={jumpLabelByKey}
      {...(onNavigate ? { onNavigate } : {})}
      onStartConversation={(row) => {
        onNavigate?.();
        void openBot(row);
      }}
      onContextMenu={(row, event) => void showBotContextMenu(row, event)}
    />
  );
}

function AddBotButton() {
  return (
    <Button size="sm" variant="outline" onClick={openCreateBotDialog}>
      <PlusIcon className="size-4" />
      Add bot
    </Button>
  );
}

export default function BotSidebar() {
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <>
      <SidebarChromeHeader
        isElectron={isElectron}
        actions={
          <>
            <SidebarHeaderRoundButton label="Search" onClick={() => openCommandPalette()}>
              <SearchIcon />
            </SidebarHeaderRoundButton>
            <SidebarHeaderRoundButton label="Add bot" onClick={openCreateBotDialog}>
              <PlusIcon />
            </SidebarHeaderRoundButton>
          </>
        }
      />
      <SidebarContent className="min-h-full">
        <SidebarGroup className="flex-1" role="presentation">
          <BotListPanel {...(isMobile ? { onNavigate: () => setOpenMobile(false) } : {})} />
          <div className="mt-auto pt-2">
            <ArchivedBotList />
          </div>
        </SidebarGroup>
      </SidebarContent>
      <SidebarChromeFooter />
    </>
  );
}

function SidebarHeaderRoundButton(props: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="glass" size="icon-sm" aria-label={props.label} onClick={props.onClick} />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup side="bottom">{props.label}</TooltipPopup>
    </Tooltip>
  );
}
