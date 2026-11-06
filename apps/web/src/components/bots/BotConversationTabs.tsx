import {
  deriveBotConversations,
  type BotConversationTab,
} from "@t3tools/client-runtime/state/bot-list";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import type { ThreadId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { useQuietThreadShells } from "../../state/entities";
import { useUiStateStore } from "../../uiStateStore";
import { ScrollArea } from "../ui/scroll-area";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const TAB_CLASS_NAME =
  "flex h-6 max-w-44 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

/**
 * A bot's conversations as tabs in its chat header, shown once it has more than its main one or
 * a new one is being written. The active tab is `activeTab`, so the header keeps its title menu.
 */
export function BotConversationTabs(props: {
  readonly project: EnvironmentProject;
  readonly activeThreadId: ThreadId;
  /** A new conversation being written, not yet on the server. */
  readonly drafting: boolean;
  readonly activeTab: ReactNode;
  readonly onNewConversation: () => void;
}) {
  const threads = useQuietThreadShells();
  const localLastVisitedAt = useUiStateStore((state) => state.threadLastVisitedAtById);
  const tabs = deriveBotConversations({ project: props.project, threads, localLastVisitedAt });
  if (tabs.length + (props.drafting ? 1 : 0) < 2) return props.activeTab;
  return (
    <ScrollArea radius="none" hideScrollbars scrollFade className="min-w-0 flex-1">
      <nav
        aria-label={`${props.project.title} conversations`}
        className="flex h-full w-max min-w-full items-center gap-1"
      >
        {tabs.map((tab) =>
          tab.threadId === props.activeThreadId ? (
            <ActiveTab key={tab.threadId}>{props.activeTab}</ActiveTab>
          ) : (
            <ConversationTab key={tab.threadId} tab={tab} />
          ),
        )}
        {props.drafting ? <ActiveTab>{props.activeTab}</ActiveTab> : null}
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={`New conversation with ${props.project.title}`}
                onClick={props.onNewConversation}
                className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-hidden hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              />
            }
          >
            <PlusIcon aria-hidden className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup side="bottom">New conversation</TooltipPopup>
        </Tooltip>
      </nav>
    </ScrollArea>
  );
}

function ActiveTab(props: { readonly children: ReactNode }) {
  return (
    <div aria-current="page" className={cn(TAB_CLASS_NAME, "bg-accent text-foreground")}>
      {props.children}
    </div>
  );
}

function ConversationTab(props: { readonly tab: BotConversationTab }) {
  const { tab } = props;
  const marker =
    tab.status === "needs-you"
      ? { label: "Needs you", className: "bg-warning" }
      : tab.unread
        ? { label: "Unread", className: "bg-primary" }
        : null;
  return (
    <Link
      to="/$environmentId/$threadId"
      params={{ environmentId: tab.environmentId, threadId: tab.threadId }}
      className={cn(
        TAB_CLASS_NAME,
        "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        tab.unread && "font-medium text-foreground",
      )}
    >
      <span className="min-w-0 truncate">{tab.title}</span>
      {marker === null ? null : (
        <span
          role="img"
          aria-label={marker.label}
          className={cn("size-1.5 shrink-0 rounded-full", marker.className)}
        />
      )}
    </Link>
  );
}
