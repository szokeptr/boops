import { sidebarRoomKey } from "@t3tools/client-runtime/state/sidebar-sections";
import { sortRoomsByActivity } from "@t3tools/client-runtime/state/room-list";
import type { EnvironmentId, RoomSummary } from "@t3tools/contracts";
import {
  StackActions,
  useNavigation,
  useNavigationState,
  type NavigationState,
} from "@react-navigation/native";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";

import { RelativeTime } from "../../components/RelativeTime";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { Menu } from "../../components/ui/Menu";
import { cn } from "../../lib/cn";
import { appAtomRegistry } from "../../state/atom-registry";
import { useEnvironments } from "../../state/environments";
import { useRooms } from "../../state/rooms";
import {
  clearComposerDraft,
  composerDraftsAtom,
  composerDraftsLoadedAtom,
} from "../../state/use-composer-drafts";
import { BotStatusLabel } from "../bots/BotListRow";
import { useMoveToSectionAction } from "../bots/sidebarSections";
import { useSelectWorkspaceDetail } from "../workspace/useSelectWorkspaceDetail";
import { RoomAvatar } from "./RoomAvatar";
import { staleRoomDraftKeys } from "./roomDrafts";
import { canManageRoom, roomRowSubtitle } from "./roomPresentation";
import { useRoomCommands, useRoomViewer } from "./useRoomCommands";

const first = (value: unknown) =>
  typeof value === "string" ? value : Array.isArray(value) ? String(value[0]) : null;

// A primitive, so the rows re-render only when the open room changes.
function openRoomKey(state: NavigationState): string | null {
  const route = state.routes
    .slice(0, state.index + 1)
    .findLast((candidate) => candidate.name === "Room");
  const params = (route?.params ?? {}) as Readonly<Record<string, unknown>>;
  const environmentId = first(params.environmentId);
  const roomId = first(params.roomId);
  return environmentId && roomId ? `${environmentId}\n${roomId}` : null;
}

/** Group chats on every connected machine, below the bots, except those placed in a section. */
export function RoomListSection(props: {
  readonly searchQuery: string;
  readonly placedKeys?: ReadonlySet<string>;
}) {
  const { environments } = useEnvironments();
  return (
    <>
      {environments.map((environment) => (
        <EnvironmentRooms
          key={environment.environmentId}
          environmentId={environment.environmentId}
          label={environments.length > 1 ? environment.label : null}
          searchQuery={props.searchQuery}
          placedKeys={props.placedKeys}
        />
      ))}
    </>
  );
}

function EnvironmentRooms(props: {
  readonly environmentId: EnvironmentId;
  readonly label: string | null;
  readonly searchQuery: string;
  readonly placedKeys: ReadonlySet<string> | undefined;
}) {
  const { environmentId } = props;
  const navigation = useNavigation();
  const { rooms, canCreate, loaded } = useRooms(environmentId);
  const draftsLoaded = useAtomValue(composerDraftsLoadedAtom);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drops persisted drafts of rooms the server no longer lists as joined
  useEffect(() => {
    if (!loaded || !draftsLoaded) return;
    const joinedIds = rooms.flatMap((room) => (room.joined ? [room.id] : []));
    const drafts = Object.keys(appAtomRegistry.get(composerDraftsAtom));
    for (const key of staleRoomDraftKeys(drafts, environmentId, joinedIds)) {
      clearComposerDraft(key);
    }
  }, [environmentId, rooms, loaded, draftsLoaded]);
  const [showArchived, setShowArchived] = useState(false);
  const openKey = useNavigationState(openRoomKey);
  const needle = props.searchQuery.trim().toLocaleLowerCase();
  const matches = (room: RoomSummary) =>
    needle.length === 0 || room.title.toLocaleLowerCase().includes(needle);
  const joined = sortRoomsByActivity(rooms.filter((room) => room.joined && matches(room)));
  const active = joined.filter(
    (room) =>
      room.archivedAt === null && !props.placedKeys?.has(sidebarRoomKey(environmentId, room.id)),
  );
  const archived = joined.filter((room) => room.archivedAt !== null);
  if (active.length === 0 && archived.length === 0 && (!canCreate || needle.length > 0)) {
    return null;
  }
  const createRoom = () => navigation.navigate("CreateRoom", { environmentId });
  if (joined.length === 0) {
    // With no group chats yet, one quiet row stands in for the whole section.
    return (
      <Pressable
        accessibilityRole="button"
        className="mt-2 min-h-[44px] flex-row items-center gap-3.5 self-start rounded-xl pr-3 pl-2 active:opacity-70"
        onPress={createRoom}
      >
        {/* Centred in the avatar column, so the label starts where bot names do. */}
        <View className="w-[50px] items-center">
          <SymbolView name="person.2" size={17} tintColorClassName="accent-foreground-muted" />
        </View>
        <Text className="text-[15px] text-foreground-muted">
          {props.label === null ? "Start a group chat" : `Start a group chat on ${props.label}`}
        </Text>
      </Pressable>
    );
  }
  return (
    <View accessibilityLabel="Group chats" className="mt-4">
      <View className="min-h-9 flex-row items-center justify-between pr-1 pl-2">
        <Text className="font-t3-bold text-sm text-foreground-muted">
          {props.label === null ? "Group chats" : `Group chats · ${props.label}`}
        </Text>
        {canCreate ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="New group chat"
            hitSlop={6}
            className="size-9 items-center justify-center rounded-full active:opacity-60"
            onPress={createRoom}
          >
            <SymbolView name="plus" size={16} tintColorClassName="accent-foreground-muted" />
          </Pressable>
        ) : null}
      </View>
      {active.map((room) => (
        <RoomListRow
          key={room.id}
          environmentId={environmentId}
          room={room}
          selected={openKey === `${environmentId}\n${room.id}`}
        />
      ))}
      {archived.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: showArchived }}
          className="min-h-11 flex-row items-center gap-2 rounded-xl px-2 active:opacity-70"
          onPress={() => setShowArchived((current) => !current)}
        >
          <SymbolView name="archivebox" size={14} tintColorClassName="accent-foreground-muted" />
          <Text className="flex-1 text-sm text-foreground-muted">Archived</Text>
          <Text className="text-sm tabular-nums text-foreground-muted">{archived.length}</Text>
          <SymbolView
            name={showArchived ? "chevron.down" : "chevron.right"}
            size={12}
            tintColorClassName="accent-foreground-muted"
          />
        </Pressable>
      ) : null}
      {showArchived
        ? archived.map((room) => (
            <RoomListRow
              key={room.id}
              environmentId={environmentId}
              room={room}
              selected={openKey === `${environmentId}\n${room.id}`}
            />
          ))
        : null}
    </View>
  );
}

/** A room shown in one of the viewer's sections. */
export function SidebarRoomRow(props: {
  readonly environmentId: EnvironmentId;
  readonly room: RoomSummary;
}) {
  const openKey = useNavigationState(openRoomKey);
  return (
    <RoomListRow
      environmentId={props.environmentId}
      room={props.room}
      selected={openKey === `${props.environmentId}\n${props.room.id}`}
    />
  );
}

function RoomListRow(props: {
  readonly environmentId: EnvironmentId;
  readonly room: RoomSummary;
  readonly selected: boolean;
}) {
  const { room, environmentId, selected } = props;
  const navigation = useNavigation();
  const selectDetail = useSelectWorkspaceDetail();
  const commands = useRoomCommands(environmentId);
  const { viewer, viewerKey, avatarOf } = useRoomViewer(environmentId);
  const manages = canManageRoom(room, viewer);
  const foreground = selected ? "text-thread-selected-foreground" : "text-foreground";
  const muted = selected ? "text-thread-selected-foreground-muted" : "text-foreground-muted";
  const mutedTint = selected
    ? "accent-thread-selected-foreground-muted"
    : "accent-foreground-muted";
  const subtitle = roomRowSubtitle(room, viewerKey);
  const archived = room.archivedAt !== null;
  const move = useMoveToSectionAction(sidebarRoomKey(environmentId, room.id));
  // Beside the list (split view) the room may be open; it is gone, so close it like its own menu.
  const done = () => {
    if (selected) navigation.dispatch(StackActions.popToTop());
  };
  // Same entries and gating as the room screen's header menu; SF names map to Android icons.
  const actions = [
    ...(manages ? [{ id: "rename", title: "Rename…", image: "pencil" }] : []),
    {
      id: "mute",
      title: room.muted ? "Unmute" : "Mute",
      image: room.muted ? "bell" : "bell.slash",
    },
    ...(manages
      ? [{ id: "archive", title: archived ? "Unarchive" : "Archive", image: "archivebox" }]
      : []),
    { id: "leave", title: "Leave", image: "rectangle.portrait.and.arrow.right" },
    ...(manages
      ? [{ id: "delete", title: "Delete…", image: "trash", attributes: { destructive: true } }]
      : []),
    ...(archived ? [] : move.actions),
  ];
  return (
    <View className={cn("rounded-xl", selected && "bg-thread-selected")}>
      <Menu
        actions={actions}
        shouldOpenOnLongPress
        onPressAction={({ nativeEvent }) => {
          if (move.handle(nativeEvent.event)) return;
          if (nativeEvent.event === "rename") commands.rename(room.id, room.title);
          if (nativeEvent.event === "mute") void commands.setMuted(room.id, !room.muted);
          if (nativeEvent.event === "archive") void commands.setArchived(room.id, !archived);
          if (nativeEvent.event === "leave") commands.leave(room.id, room.title, done);
          if (nativeEvent.event === "delete") commands.delete(room.id, room.title, done);
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={[
            room.title,
            room.needsYou ? "needs you" : null,
            room.unread ? "unread" : null,
            room.muted ? "muted" : null,
            subtitle,
          ]
            .filter((part) => part !== null)
            .join(", ")}
          accessibilityState={{ selected }}
          className="min-w-0 flex-row items-center gap-3 rounded-xl py-2 pr-3 pl-2 active:opacity-70"
          onPress={() =>
            selectDetail({
              name: "Room",
              params: { environmentId: String(environmentId), roomId: String(room.id) },
            })
          }
        >
          <RoomAvatar
            participants={room.participants}
            viewerKey={viewerKey}
            avatarOf={avatarOf}
            size={44}
          />
          <View className="min-w-0 flex-1 gap-0.5">
            <View className="flex-row items-center gap-1.5">
              <Text
                numberOfLines={1}
                className={cn(
                  "min-w-0 shrink text-base",
                  room.unread ? "font-t3-bold" : "font-t3-medium",
                  foreground,
                )}
              >
                {room.title}
              </Text>
              {room.muted ? (
                <SymbolView
                  name="bell.slash.fill"
                  size={11}
                  tintColorClassName={mutedTint}
                  type="monochrome"
                />
              ) : null}
              <View className="flex-1" />
              {room.needsYou ? <BotStatusLabel status="needs-you" /> : null}
              {room.lastMessage === null ? null : (
                <Text className={cn("text-xs tabular-nums", muted)}>
                  <RelativeTime timestamp={room.lastMessage.createdAt} />
                </Text>
              )}
            </View>
            <View className="flex-row items-center gap-2">
              <Text
                numberOfLines={1}
                className={cn("min-w-0 flex-1 text-sm", room.unread ? foreground : muted)}
              >
                {subtitle}
              </Text>
              {room.unread && !room.muted ? (
                <View className="size-2.5 rounded-full bg-primary" />
              ) : null}
            </View>
          </View>
        </Pressable>
      </Menu>
    </View>
  );
}
