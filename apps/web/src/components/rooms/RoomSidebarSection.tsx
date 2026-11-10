import { useAtomValue } from "@effect/atom-react";
import { roomLastActivity, sortRoomsByActivity } from "@t3tools/client-runtime/state/room-list";
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
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { memberEnvironment } from "../../state/members";
import { type EnvironmentRooms, useRoomLists } from "../../state/rooms";
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
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { openCreateRoomDialog } from "./CreateRoomDialog";
import { openRenameRoomDialog } from "./RenameRoomDialog";
import { RoomAvatar } from "./RoomAvatar";
import { roomMessagePreview } from "./roomPreview";
import { useRoomCommands } from "./useRoomCommands";

const ROW_CLASS =
  "flex w-full cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-left outline-hidden hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[active=true]:bg-sidebar-row-selected";

function useMyKey(environmentId: EnvironmentId) {
  const sessionMember = useAtomValue(memberEnvironment.sessionMemberAtom(environmentId));
  return sessionMember === null ? "owner" : `member:${sessionMember.id}`;
}

const shownRooms = (list: EnvironmentRooms) =>
  list.snapshot?.rooms.filter((room) => room.joined) ?? [];

/** Group chats on every connected machine, under one heading, except those placed in a section. */
export function RoomSidebarSection({
  onNavigate,
  placedKeys,
}: {
  readonly onNavigate?: () => void;
  readonly placedKeys?: ReadonlySet<string>;
}) {
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { setNodeRef: setUnsortedDropRef, isOver: unsortedDropIsOver } =
    useSidebarUnsortedDrop("unsorted:rooms");
  const lists = useRoomLists(environments.map((environment) => environment.environmentId));
  const labelOf = new Map(
    environments.map((environment) => [environment.environmentId, environment.label]),
  );
  const visible = lists.filter(
    (list) => list.snapshot !== null && (list.snapshot.canCreate || shownRooms(list).length > 0),
  );
  if (visible.length === 0) return null;
  const creatable = visible.filter((list) => list.snapshot?.canCreate === true);
  const labelled = visible.length > 1;
  const anyOpen = visible.some((list) => shownRooms(list).some((room) => room.archivedAt === null));
  const createTarget =
    creatable.find((list) => list.environmentId === primaryEnvironmentId) ?? creatable[0];
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
        {creatable.length === 1 ? (
          <Button
            aria-label="New group chat"
            size="icon-xs"
            variant="ghost"
            onClick={() => openCreateRoomDialog(creatable[0]!.environmentId)}
          >
            <PlusIcon />
          </Button>
        ) : creatable.length > 1 ? (
          <Menu>
            <MenuTrigger
              render={<Button aria-label="New group chat" size="icon-xs" variant="ghost" />}
            >
              <PlusIcon />
            </MenuTrigger>
            <MenuPopup align="end">
              {creatable.map((list) => (
                <MenuItem
                  key={list.environmentId}
                  onClick={() => openCreateRoomDialog(list.environmentId)}
                >
                  {`On ${labelOf.get(list.environmentId) ?? "this machine"}`}
                </MenuItem>
              ))}
            </MenuPopup>
          </Menu>
        ) : null}
      </div>
      {!anyOpen && createTarget !== undefined ? (
        <button
          type="button"
          onClick={() => openCreateRoomDialog(createTarget.environmentId)}
          className="mx-2 cursor-pointer rounded-xl border border-dashed border-sidebar-border px-3 py-3 text-left text-sidebar-muted-foreground text-xs hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
        >
          Start a group chat with your bots and the people you share them with.
        </button>
      ) : null}
      {visible.map((list) => (
        <EnvironmentRoomList
          key={list.environmentId}
          environmentId={list.environmentId}
          rooms={shownRooms(list)}
          placedKeys={placedKeys}
          label={labelled ? (labelOf.get(list.environmentId) ?? null) : null}
          {...(onNavigate ? { onNavigate } : {})}
        />
      ))}
    </section>
  );
}

function EnvironmentRoomList({
  environmentId,
  rooms,
  placedKeys,
  label,
  onNavigate,
}: {
  readonly environmentId: EnvironmentId;
  readonly rooms: ReadonlyArray<RoomSummary>;
  readonly placedKeys: ReadonlySet<string> | undefined;
  readonly label: string | null;
  readonly onNavigate?: () => void;
}) {
  const activeRoomId = useParams({
    strict: false,
    select: (params) => (params.environmentId === environmentId ? params.roomId : undefined),
  });
  const open = sortRoomsByActivity(
    rooms.filter(
      (room) =>
        room.archivedAt === null && !placedKeys?.has(sidebarRoomKey(environmentId, room.id)),
    ),
  );
  const archived = rooms.filter((room) => room.archivedAt !== null);
  if (open.length === 0 && archived.length === 0) return null;
  return (
    <>
      {label === null ? null : (
        <h3 className="truncate px-2 pt-1.5 pb-0.5 text-2xs text-sidebar-muted-foreground">
          {label}
        </h3>
      )}
      <ul aria-label={label ?? undefined} className="flex flex-col gap-px">
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
    </>
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
    last === null ? `${room.participants.length} in the chat` : roomMessagePreview(last, myKey);
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
              <RelativeTime timestamp={roomLastActivity(room)} />
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
  const showMenu = useRoomContextMenu(props.environmentId);
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
                  onContextMenu={(event) => void showMenu(room, event)}
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

/** Right-click on a group chat: rename, mute, archive, leave or delete without opening it. */
function useRoomContextMenu(environmentId: EnvironmentId) {
  const commands = useRoomCommands(environmentId);
  const navigate = useNavigate();
  const activeRoomId = useParams({
    strict: false,
    select: (params) => (params.environmentId === environmentId ? params.roomId : undefined),
  });
  const myKey = useMyKey(environmentId);
  return async (
    room: RoomSummary,
    event: MouseEvent,
    // Absent for an archived chat, which sits outside the sections.
    moveMenu?: ReturnType<typeof useMoveToSectionMenu>,
  ) => {
    const api = readLocalApi();
    if (!api) return;
    event.preventDefault();
    const canManage = myKey === "owner" || roomParticipantKey(room.createdBy) === myKey;
    const archived = room.archivedAt !== null;
    const items: Array<ContextMenuItem> = [];
    if (canManage) items.push({ id: "rename", label: "Rename…" });
    items.push({ id: "mute", label: room.muted ? "Unmute" : "Mute" }, ...(moveMenu?.items ?? []));
    if (canManage) items.push({ id: "archive", label: archived ? "Unarchive" : "Archive" });
    items.push({ id: "leave", label: "Leave", separatorBefore: true });
    if (canManage) items.push({ id: "delete", label: "Delete…", destructive: true });
    const action = await api.contextMenu.show(items, { x: event.clientX, y: event.clientY });
    if (moveMenu?.handle(action)) return;
    const away = async () => {
      if (activeRoomId === room.id) await navigate({ to: "/" });
    };
    if (action === "rename") {
      openRenameRoomDialog({ environmentId, roomId: room.id, title: room.title });
    }
    if (action === "mute") void commands.setMuted(room.id, !room.muted);
    if (action === "archive" && (await commands.setArchived(room.id, !archived)) && !archived) {
      await away();
    }
    if (action === "leave" && (await commands.leave(room.id, room.title))) await away();
    if (action === "delete" && (await commands.delete(room.id, room.title))) await away();
  };
}
