import { useAtomValue } from "@effect/atom-react";
import type { BotRow } from "@t3tools/client-runtime/state/bot-list";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { useParams, useRouter } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { useEffect, type ComponentProps, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { isCommandPaletteOpen } from "../../commandPaletteBus";
import { openCreateBotDialog } from "../CreateBotDialog";
import { isElectron } from "../../env";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
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
import { SidebarContent, SidebarGroup, SidebarMenuButton, useSidebar } from "../ui/sidebar";
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

export function BotListPanel({ onNavigate }: { readonly onNavigate?: () => void }) {
  const rows = useBotRows();
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
      rows={rows}
      activeKey={activeKey}
      showMachineBadges={new Set(rows.map((row) => row.environmentId)).size > 1}
      machineKindById={machineKindById}
      jumpLabelByKey={jumpLabelByKey}
      {...(onNavigate ? { onNavigate } : {})}
      onStartConversation={(row) => {
        onNavigate?.();
        void openBot(row);
      }}
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
      <SidebarChromeHeader isElectron={isElectron} />
      <SidebarContent
        className="min-h-full"
        fixedHeader={
          <SidebarGroup className="z-[1]">
            <div className="flex h-8 items-center gap-1 pl-2">
              <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-sidebar-muted-foreground">
                Bots
              </h2>
              <SidebarHeaderIconButton label="Add bot" onClick={openCreateBotDialog}>
                <PlusIcon />
              </SidebarHeaderIconButton>
            </div>
          </SidebarGroup>
        }
      >
        <SidebarGroup className="flex-1" role="presentation">
          <BotListPanel {...(isMobile ? { onNavigate: () => setOpenMobile(false) } : {})} />
          <ArchivedBotList />
        </SidebarGroup>
      </SidebarContent>
      <SidebarChromeFooter />
    </>
  );
}

function SidebarHeaderIconButton({
  label,
  className,
  children,
  ...rest
}: {
  label: string;
  className?: string | undefined;
  children?: ReactNode;
} & Omit<
  ComponentProps<typeof SidebarMenuButton>,
  "children" | "className" | "tooltip" | "isActive" | "aria-label"
>) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <SidebarMenuButton
            size="icon"
            type="button"
            aria-label={label}
            {...rest}
            className={cn("relative size-7 shrink-0", className)}
          />
        }
      >
        {children}
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
        />
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}
