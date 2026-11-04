import type { BotRow } from "@t3tools/client-runtime/state/bot-list";
import type { EnvironmentId, EnvironmentMachineKind } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { HistoryIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { RelativeTime } from "../RelativeTime";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { BotAvatarSlot } from "./BotAvatarSlot";
import { BotStatusLabel } from "./BotStatusLabel";

export interface BotListProps {
  readonly rows: ReadonlyArray<BotRow>;
  readonly activeKey: string | null;
  /** Badges only tell bots apart when they run on more than one machine. */
  readonly showMachineBadges: boolean;
  readonly machineKindById: ReadonlyMap<EnvironmentId, EnvironmentMachineKind>;
  readonly jumpLabelByKey?: ReadonlyMap<string, string>;
  /** Runs after a row or its activity link navigates, such as closing the mobile sheet. */
  readonly onNavigate?: () => void;
  /** Opens a bot that has no conversation yet. */
  readonly onStartConversation: (row: BotRow) => void;
}

const ROW_CLASS =
  "flex w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-left outline-hidden hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[active=true]:bg-sidebar-row-selected";

export function BotList(props: BotListProps) {
  return (
    <ul aria-label="Bots" className="flex flex-col gap-px">
      {props.rows.map((row) => (
        <BotListRow
          key={row.key}
          row={row}
          isActive={props.activeKey === row.key}
          showMachineBadge={props.showMachineBadges}
          machineKind={props.machineKindById.get(row.environmentId) ?? "server"}
          jumpLabel={props.jumpLabelByKey?.get(row.key) ?? null}
          onNavigate={props.onNavigate}
          onStartConversation={props.onStartConversation}
        />
      ))}
    </ul>
  );
}

function botRowLabel(row: BotRow): string {
  const status =
    row.status === "needs-you" ? "needs you" : row.status === "working" ? "working" : null;
  return [row.name, status, row.unread ? "unread" : null, row.lastMessagePreview]
    .filter((part) => part !== null)
    .join(", ");
}

function BotListRow(props: {
  readonly row: BotRow;
  readonly isActive: boolean;
  readonly showMachineBadge: boolean;
  readonly machineKind: EnvironmentMachineKind;
  readonly jumpLabel: string | null;
  readonly onNavigate: (() => void) | undefined;
  readonly onStartConversation: (row: BotRow) => void;
}) {
  const { row } = props;
  const content = (
    <>
      <BotAvatarSlot avatar={row.avatar} name={row.name} status={row.status} size={32} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-baseline gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm text-sidebar-foreground",
              row.unread ? "font-semibold" : "font-medium",
            )}
          >
            {row.name}
          </span>
          <span className="shrink-0 text-2xs text-sidebar-muted-foreground tabular-nums">
            {props.jumpLabel ?? <RelativeTime timestamp={row.lastActivityAt} />}
          </span>
        </span>
        <span
          className={cn(
            "flex min-w-0 items-center gap-1.5 text-xs text-sidebar-muted-foreground",
            row.activityThreadCount > 0 && "pr-7",
          )}
        >
          <BotStatusLabel status={row.status} />
          {row.status !== "needs-you" && row.status !== "working" ? (
            <span
              className={cn("min-w-0 flex-1 truncate", row.unread && "text-sidebar-foreground")}
            >
              {row.lastMessagePreview === null
                ? "No messages yet"
                : row.lastMessageFromUser
                  ? `You: ${row.lastMessagePreview}`
                  : row.lastMessagePreview}
            </span>
          ) : (
            <span className="flex-1" />
          )}
          {row.unread ? (
            <span
              aria-label="Unread"
              role="img"
              className="size-2 shrink-0 rounded-full bg-primary"
            />
          ) : null}
          {props.showMachineBadge ? (
            <MachineBadge label={row.machineLabel} kind={props.machineKind} />
          ) : null}
        </span>
      </span>
    </>
  );

  return (
    <li className="relative list-none">
      {row.mainThreadId === null ? (
        <button
          type="button"
          className={ROW_CLASS}
          aria-label={botRowLabel(row)}
          data-active={props.isActive}
          onClick={() => props.onStartConversation(row)}
        >
          {content}
        </button>
      ) : (
        <Link
          to="/$environmentId/$threadId"
          params={{ environmentId: row.environmentId, threadId: row.mainThreadId }}
          className={ROW_CLASS}
          aria-label={botRowLabel(row)}
          data-active={props.isActive}
          aria-current={props.isActive ? "page" : undefined}
          onClick={props.onNavigate}
        >
          {content}
        </Link>
      )}
      {row.activityThreadCount > 0 ? (
        <BotActivityLink row={row} onNavigate={props.onNavigate} />
      ) : null}
    </li>
  );
}

function BotActivityLink(props: {
  readonly row: BotRow;
  readonly onNavigate?: (() => void) | undefined;
}) {
  const label = `${props.row.name} activity (${props.row.activityThreadCount})`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            to="/bots/$environmentId/$projectId/activity"
            params={{ environmentId: props.row.environmentId, projectId: props.row.projectId }}
            aria-label={label}
            onClick={props.onNavigate}
            className="absolute right-2 bottom-2 inline-flex h-5 items-center gap-0.5 rounded-md px-1 text-2xs text-sidebar-muted-foreground tabular-nums hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:outline-hidden"
          />
        }
      >
        <HistoryIcon aria-hidden className="size-3" />
        {props.row.activityThreadCount}
      </TooltipTrigger>
      <TooltipPopup side="top">Activity</TooltipPopup>
    </Tooltip>
  );
}

function MachineBadge(props: {
  readonly label: string | null;
  readonly kind: EnvironmentMachineKind;
}): ReactNode {
  const label = props.label ?? "Unknown machine";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={`On ${label}`}
            className="inline-flex shrink-0 items-center text-sidebar-muted-foreground/70"
          />
        }
      >
        <EnvironmentMachineIcon aria-hidden kind={props.kind} className="size-3" />
      </TooltipTrigger>
      <TooltipPopup side="top">On {label}</TooltipPopup>
    </Tooltip>
  );
}
