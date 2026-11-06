import type { BotRow } from "@t3tools/client-runtime/state/bot-list";
import type { EnvironmentId, EnvironmentMachineKind } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { HistoryIcon } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";

import { cn } from "~/lib/utils";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { RelativeTime } from "../RelativeTime";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { BotAvatar } from "./BotAvatar";

export interface BotListProps {
  /** Shown as avatars above the list, in this order. */
  readonly pinnedRows: ReadonlyArray<BotRow>;
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
  readonly onContextMenu?: (row: BotRow, event: MouseEvent) => void;
}

const ROW_CLASS =
  "flex w-full cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-left outline-hidden hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[active=true]:bg-sidebar-row-selected";

const TILE_CLASS =
  "flex w-full cursor-pointer flex-col items-center gap-1.5 rounded-xl px-1 pt-2 pb-1.5 outline-hidden hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[active=true]:bg-sidebar-row-selected";

export function BotList(props: BotListProps) {
  return (
    <div className="flex flex-col gap-3">
      {props.pinnedRows.length > 0 ? (
        <ul aria-label="Pinned bots" className="flex flex-wrap justify-center">
          {props.pinnedRows.map((row) => (
            <PinnedBotTile
              key={row.key}
              row={row}
              isActive={props.activeKey === row.key}
              jumpLabel={props.jumpLabelByKey?.get(row.key) ?? null}
              onNavigate={props.onNavigate}
              onStartConversation={props.onStartConversation}
              onContextMenu={props.onContextMenu}
            />
          ))}
        </ul>
      ) : null}
      {props.rows.length > 0 ? (
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
              onContextMenu={props.onContextMenu}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function botRowLabel(row: BotRow): string {
  const status =
    row.status === "needs-you" ? "needs you" : row.status === "working" ? "working" : null;
  const madeBy = row.madeBy === null ? null : `made by ${row.madeBy}`;
  return [row.name, madeBy, status, row.unread ? "unread" : null, row.lastMessagePreview]
    .filter((part) => part !== null)
    .join(", ");
}

interface BotEntryProps {
  readonly row: BotRow;
  readonly isActive: boolean;
  readonly jumpLabel: string | null;
  readonly onNavigate: (() => void) | undefined;
  readonly onStartConversation: (row: BotRow) => void;
  readonly onContextMenu: ((row: BotRow, event: MouseEvent) => void) | undefined;
}

/** Opens the bot's conversation, or starts one when it has none yet. */
function BotEntryTarget(props: BotEntryProps & { className: string; children: ReactNode }) {
  const { row } = props;
  const onContextMenu = props.onContextMenu
    ? (event: MouseEvent) => props.onContextMenu?.(row, event)
    : undefined;
  return row.mainThreadId === null ? (
    <button
      type="button"
      className={props.className}
      aria-label={botRowLabel(row)}
      data-active={props.isActive}
      onClick={() => props.onStartConversation(row)}
      onContextMenu={onContextMenu}
    >
      {props.children}
    </button>
  ) : (
    <Link
      to="/$environmentId/$threadId"
      params={{ environmentId: row.environmentId, threadId: row.mainThreadId }}
      className={props.className}
      aria-label={botRowLabel(row)}
      data-active={props.isActive}
      aria-current={props.isActive ? "page" : undefined}
      onClick={props.onNavigate}
      onContextMenu={onContextMenu}
    >
      {props.children}
    </Link>
  );
}

function rowAvatarProps(row: BotRow) {
  return row.status === "hatching"
    ? ({ status: "idle", hatchStage: "egg" } as const)
    : ({ status: row.status } as const);
}

function PinnedBotTile(props: BotEntryProps) {
  const { row } = props;
  return (
    <li className="w-20 list-none">
      <BotEntryTarget {...props} className={TILE_CLASS}>
        <span className="relative">
          <BotAvatar avatar={row.avatar} name={row.name} size={52} {...rowAvatarProps(row)} />
          {row.unread ? (
            <span
              aria-hidden
              className="absolute top-0 right-0 size-2.5 rounded-full bg-primary ring-2 ring-sidebar"
            />
          ) : null}
        </span>
        <span
          className={cn(
            "w-full truncate text-center text-xs text-sidebar-foreground",
            row.unread ? "font-semibold" : "font-medium",
          )}
        >
          {props.jumpLabel ?? row.name}
        </span>
      </BotEntryTarget>
    </li>
  );
}

function BotListRow(
  props: BotEntryProps & {
    readonly showMachineBadge: boolean;
    readonly machineKind: EnvironmentMachineKind;
  },
) {
  const { row } = props;
  return (
    <li className="group/bot relative list-none">
      <BotEntryTarget {...props} className={ROW_CLASS}>
        <BotAvatar avatar={row.avatar} name={row.name} size={44} {...rowAvatarProps(row)} />
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
            {props.showMachineBadge ? (
              <MachineBadge label={row.machineLabel} kind={props.machineKind} />
            ) : null}
            <span className="shrink-0 text-2xs text-sidebar-muted-foreground tabular-nums">
              {props.jumpLabel ?? <RelativeTime timestamp={row.lastActivityAt} />}
            </span>
          </span>
          <span
            className={cn(
              "min-w-0 truncate text-sm text-sidebar-muted-foreground",
              row.unread && "text-sidebar-foreground",
              row.activityThreadCount > 0 &&
                "group-hover/bot:pr-8 group-focus-within/bot:pr-8 pointer-coarse:pr-8",
            )}
          >
            {row.lastMessagePreview === null
              ? "No messages yet"
              : row.lastMessageFromUser
                ? `You: ${row.lastMessagePreview}`
                : row.lastMessagePreview}
          </span>
        </span>
      </BotEntryTarget>
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
            className="absolute right-2 bottom-2.5 inline-flex h-5 items-center gap-0.5 rounded-md px-1 text-2xs text-sidebar-muted-foreground tabular-nums opacity-0 hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:outline-hidden group-hover/bot:opacity-100 group-focus-within/bot:opacity-100 pointer-coarse:opacity-100"
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
            className="inline-flex shrink-0 items-center self-center text-sidebar-muted-foreground/70"
          />
        }
      >
        <EnvironmentMachineIcon aria-hidden kind={props.kind} className="size-3" />
      </TooltipTrigger>
      <TooltipPopup side="top">On {label}</TooltipPopup>
    </Tooltip>
  );
}
