import { useAtomValue } from "@effect/atom-react";
import { botMessagePreview } from "@t3tools/client-runtime/state/bot-list";
import { sidebarRoomKey } from "@t3tools/client-runtime/state/sidebar-sections";
import {
  type ContextMenuItem,
  type EnvironmentId,
  roomParticipantKey,
  type RoomSummary,
  type SidebarSectionId,
} from "@t3tools/contracts";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { BellOffIcon, ChevronRightIcon, PlusIcon } from "lucide-react";
import type { MouseEvent } from "react";

import { cn } from "../../lib/utils";
import { readLocalApi } from "../../localApi";
import { useEnvironments } from "../../state/environments";
import { memberEnvironment } from "../../state/members";
import { useRooms } from "../../state/rooms";
import { RelativeTime } from "../RelativeTime";
import {
  type SidebarEntryDnd,
  sidebarEntryDndClassName,
  useSidebarEntryDnd,
  useSidebarUnsortedDrop,
} from "../bots/sidebarDnd";
import { useMoveToSectionMenu } from "../bots/sidebarSectionsContext";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { openCreateRoomDialog } from "./CreateRoomDialog";
import { RoomAvatar } from "./RoomAvatar";
import { useRoomCommands } from "./useRoomCommands";

const ROW_CLASS =
  "flex w-full cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-left outline-hidden hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[active=true]:bg-sidebar-row-selected";

/** Newest conversation first, as a messages app sorts. */
export const lastActivity = (room: RoomSummary) => room.lastMessage?.createdAt ?? room.createdAt;

function useMyKey(environmentId: EnvironmentId) {
  const sessionMember = useAtomValue(memberEnvironment.sessionMemberAtom(environmentId));
  return sessionMember === null ? "owner" : `member:${sessionMember.id}`;
}

/** Group chats on every connected machine, below the bots, except those placed in a section. */
export function RoomSidebarSection({
  onNavigate,
  placedKeys,
}: {
  readonly onNavigate?: () => void;
  readonly placedKeys?: ReadonlySet<string>;
}) {
  const { environments } = useEnvironments();
  return (
    <>
      {environments.map((environment) => (
        <EnvironmentRooms
          key={environment.environmentId}
          environmentId={environment.environmentId}
          placedKeys={placedKeys}
          {...(onNavigate ? { onNavigate } : {})}
        />
      ))}
    </>
  );
}

function EnvironmentRooms({
  environmentId,
  onNavigate,
  placedKeys,
}: {
  readonly environmentId: EnvironmentId;
  readonly onNavigate?: () => void;
  readonly placedKeys: ReadonlySet<string> | undefined;
}) {
  const { rooms, canCreate } = useRooms(environmentId);
  const activeRoomId = useParams({ strict: false, select: (params) => params.roomId });
  const { setNodeRef: setUnsortedDropRef, isOver: unsortedDropIsOver } = useSidebarUnsortedDrop(
    `unsorted:rooms:${environmentId}`,
  );
  const mine = rooms.filter((room) => room.joined);
  const open = mine
    .filter(
      (room) =>
        room.archivedAt === null && !placedKeys?.has(sidebarRoomKey(environmentId, room.id)),
    )
    .toSorted((a, b) => lastActivity(b).localeCompare(lastActivity(a)));
  const archived = mine.filter((room) => room.archivedAt !== null);
  if (mine.length === 0 && !canCreate) return null;
  return (
    <section aria-label="Group chats" className="mt-3 flex flex-col gap-px">
      <div
        ref={setUnsortedDropRef}
        className={cn(
          "flex items-center justify-between rounded-md px-2 pb-1",
          unsortedDropIsOver && "bg-sidebar-row-hover",
        )}
      >
        <h2 className="font-medium text-sidebar-muted-foreground text-xs">Group chats</h2>
        {canCreate ? (
          <Button
            aria-label="New group chat"
            size="icon-xs"
            variant="ghost"
            onClick={() => openCreateRoomDialog(environmentId)}
          >
            <PlusIcon />
          </Button>
        ) : null}
      </div>
      {canCreate && !mine.some((room) => room.archivedAt === null) ? (
        <button
          type="button"
          onClick={() => openCreateRoomDialog(environmentId)}
          className="mx-2 cursor-pointer rounded-xl border border-dashed border-sidebar-border px-3 py-3 text-left text-sidebar-muted-foreground text-xs hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
        >
          Start a group chat with your bots and the people you share them with.
        </button>
      ) : null}
      <ul className="flex flex-col gap-px">
        {open.map((room) => (
          <DraggableRoomRow
            key={room.id}
            sectionId={null}
            environmentId={environmentId}
            room={room}
            active={room.id === activeRoomId}
            {...(onNavigate ? { onNavigate } : {})}
          />
        ))}
      </ul>
      {archived.length > 0 ? (
        <ArchivedRooms environmentId={environmentId} rooms={archived} onNavigate={onNavigate} />
      ) : null}
    </section>
  );
}

/** A room row that drags into sections; `sectionId` is the section it shows in, if any. */
export function DraggableRoomRow(props: {
  readonly environmentId: EnvironmentId;
  readonly room: RoomSummary;
  readonly active: boolean;
  readonly sectionId: SidebarSectionId | null;
  readonly onNavigate?: () => void;
}) {
  const { sectionId, ...rowProps } = props;
  const dnd = useSidebarEntryDnd(
    {
      kind: "item",
      key: sidebarRoomKey(props.environmentId, props.room.id),
      label: props.room.title,
    },
    sectionId,
  );
  return <RoomRow {...rowProps} dnd={dnd} />;
}

function RoomRow(props: {
  readonly environmentId: EnvironmentId;
  readonly room: RoomSummary;
  readonly active: boolean;
  readonly onNavigate?: () => void;
  readonly dnd?: SidebarEntryDnd;
}) {
  const { room } = props;
  const last = room.lastMessage;
  const showMenu = useRoomContextMenu(props.environmentId);
  const moveMenu = useMoveToSectionMenu(sidebarRoomKey(props.environmentId, room.id));
  const myKey = useMyKey(props.environmentId);
  const preview =
    last === null
      ? `${room.participants.length} in the chat`
      : `${roomParticipantKey(last.author) === myKey ? "You" : last.authorName}: ${
          botMessagePreview(last.text) ?? (last.attachments.length > 0 ? "Sent an attachment" : "")
        }`;
  return (
    <li
      ref={props.dnd?.setNodeRef}
      {...props.dnd?.listeners}
      className={sidebarEntryDndClassName(props.dnd)}
    >
      <Link
        to="/rooms/$environmentId/$roomId"
        params={{ environmentId: props.environmentId, roomId: room.id }}
        data-active={props.active}
        className={ROW_CLASS}
        onClick={props.onNavigate}
        onContextMenu={(event) => void showMenu(room, event, moveMenu)}
      >
        <RoomAvatar
          environmentId={props.environmentId}
          participants={room.participants}
          size={44}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-baseline gap-2">
            <span
              className={cn(
                "flex min-w-0 flex-1 items-center gap-1 text-sm text-sidebar-foreground",
                room.unread ? "font-semibold" : "font-medium",
              )}
            >
              <span className="truncate">{room.title}</span>
              {room.muted ? (
                <BellOffIcon aria-label="Muted" className="size-3 shrink-0 opacity-60" />
              ) : null}
            </span>
            <span className="shrink-0 text-2xs text-sidebar-muted-foreground tabular-nums">
              <RelativeTime timestamp={lastActivity(room)} />
            </span>
          </span>
          <span className="flex min-w-0 items-center gap-2">
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-sm",
                room.needsYou
                  ? "font-medium text-primary"
                  : room.unread
                    ? "text-sidebar-foreground"
                    : "text-sidebar-muted-foreground",
              )}
            >
              {room.needsYou ? "Needs you" : room.working.length > 0 ? "Answering…" : preview}
            </span>
            {room.unread && !room.muted ? (
              <span aria-label="Unread" className="size-2 shrink-0 rounded-full bg-primary" />
            ) : null}
          </span>
        </span>
      </Link>
    </li>
  );
}

function ArchivedRooms(props: {
  readonly environmentId: EnvironmentId;
  readonly rooms: ReadonlyArray<RoomSummary>;
  readonly onNavigate: (() => void) | undefined;
}) {
  const commands = useRoomCommands(props.environmentId);
  const myKey = useMyKey(props.environmentId);
  return (
    <Collapsible>
      <CollapsibleTrigger className="mt-1 flex h-7 w-full items-center gap-1 rounded-md px-2 text-xs text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground data-panel-open:[&_svg]:rotate-90">
        <ChevronRightIcon aria-hidden className="size-3 transition-transform" />
        Archived ({props.rooms.length})
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <ul aria-label="Archived group chats" className="flex flex-col gap-px pt-1">
          {props.rooms.map((room) => {
            const canManage = myKey === "owner" || roomParticipantKey(room.createdBy) === myKey;
            return (
              <li key={room.id} className="flex list-none items-center gap-1">
                <Link
                  to="/rooms/$environmentId/$roomId"
                  params={{ environmentId: props.environmentId, roomId: room.id }}
                  onClick={props.onNavigate}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-sidebar-muted-foreground text-sm hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
                >
                  <RoomAvatar
                    environmentId={props.environmentId}
                    participants={room.participants}
                    size={18}
                  />
                  <span className="min-w-0 flex-1 truncate">{room.title}</span>
                </Link>
                {canManage ? (
                  <Button
                    size="xs"
                    variant="ghost-muted"
                    aria-label={`Unarchive ${room.title}`}
                    onClick={() => void commands.setArchived(room.id, false)}
                  >
                    Unarchive
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </CollapsiblePanel>
    </Collapsible>
  );
}

/** Right-click on a group chat: mute, archive, leave or delete without opening it. */
function useRoomContextMenu(environmentId: EnvironmentId) {
  const commands = useRoomCommands(environmentId);
  const navigate = useNavigate();
  const activeRoomId = useParams({ strict: false, select: (params) => params.roomId });
  const myKey = useMyKey(environmentId);
  return async (
    room: RoomSummary,
    event: MouseEvent,
    moveMenu: ReturnType<typeof useMoveToSectionMenu>,
  ) => {
    const api = readLocalApi();
    if (!api) return;
    event.preventDefault();
    const canManage = myKey === "owner" || roomParticipantKey(room.createdBy) === myKey;
    const items: Array<ContextMenuItem> = [
      { id: "mute", label: room.muted ? "Unmute" : "Mute" },
      ...moveMenu.items,
    ];
    if (canManage) items.push({ id: "archive", label: "Archive" });
    items.push({ id: "leave", label: "Leave", separatorBefore: true });
    if (canManage) items.push({ id: "delete", label: "Delete…", destructive: true });
    const action = await api.contextMenu.show(items, { x: event.clientX, y: event.clientY });
    if (moveMenu.handle(action)) return;
    const away = async () => {
      if (activeRoomId === room.id) await navigate({ to: "/" });
    };
    if (action === "mute") void commands.setMuted(room.id, !room.muted);
    if (action === "archive" && (await commands.setArchived(room.id, true))) await away();
    if (action === "leave" && (await commands.leave(room.id, room.title))) await away();
    if (action === "delete" && (await commands.delete(room.id, room.title))) await away();
  };
}
