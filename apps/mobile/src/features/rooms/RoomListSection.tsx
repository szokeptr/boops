import type { EnvironmentId, RoomSummary } from "@t3tools/contracts";
import { useNavigation, useNavigationState, type NavigationState } from "@react-navigation/native";
import { useState } from "react";
import { Platform, Pressable, View } from "react-native";

import { RelativeTime } from "../../components/RelativeTime";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { Menu } from "../../components/ui/Menu";
import { cn } from "../../lib/cn";
import { useEnvironments } from "../../state/environments";
import { useRooms } from "../../state/rooms";
import { BotStatusLabel } from "../bots/BotListRow";
import { useSelectWorkspaceDetail } from "../workspace/useSelectWorkspaceDetail";
import { RoomAvatar } from "./RoomAvatar";
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

/** Group chats on every connected machine, below the bots. */
export function RoomListSection(props: { readonly searchQuery: string }) {
  const { environments } = useEnvironments();
  return (
    <>
      {environments.map((environment) => (
        <EnvironmentRooms
          key={environment.environmentId}
          environmentId={environment.environmentId}
          label={environments.length > 1 ? environment.label : null}
          searchQuery={props.searchQuery}
        />
      ))}
    </>
  );
}

function EnvironmentRooms(props: {
  readonly environmentId: EnvironmentId;
  readonly label: string | null;
  readonly searchQuery: string;
}) {
  const { environmentId } = props;
  const navigation = useNavigation();
  const { rooms, canCreate } = useRooms(environmentId);
  const [showArchived, setShowArchived] = useState(false);
  const openKey = useNavigationState(openRoomKey);
  const needle = props.searchQuery.trim().toLocaleLowerCase();
  const matches = (room: RoomSummary) =>
    needle.length === 0 || room.title.toLocaleLowerCase().includes(needle);
  const joined = rooms.filter((room) => room.joined && matches(room));
  const active = joined.filter((room) => room.archivedAt === null);
  const archived = joined.filter((room) => room.archivedAt !== null);
  if (active.length === 0 && archived.length === 0 && (!canCreate || needle.length > 0)) {
    return null;
  }
  const createRoom = () => navigation.navigate("CreateRoom", { environmentId });
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
      {active.length === 0 && archived.length === 0 ? (
        <Pressable
          accessibilityRole="button"
          className="rounded-xl px-2 py-2 active:opacity-70"
          onPress={createRoom}
        >
          <Text className="text-sm text-foreground-muted">
            Talk with your bots and people together. Start a group chat.
          </Text>
        </Pressable>
      ) : null}
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

function RoomListRow(props: {
  readonly environmentId: EnvironmentId;
  readonly room: RoomSummary;
  readonly selected: boolean;
}) {
  const { room, environmentId, selected } = props;
  const selectDetail = useSelectWorkspaceDetail();
  const commands = useRoomCommands(environmentId);
  const { viewer, viewerKey, avatarOf } = useRoomViewer(environmentId);
  const manages = canManageRoom(room, viewer);
  const foreground = selected ? "text-thread-selected-foreground" : "text-foreground";
  const muted = selected ? "text-thread-selected-foreground-muted" : "text-foreground-muted";
  const mutedTint = selected
    ? "accent-thread-selected-foreground-muted"
    : "accent-foreground-muted";
  const subtitle = roomRowSubtitle(room);
  const archived = room.archivedAt !== null;
  const actions = [
    {
      id: "mute",
      title: room.muted ? "Unmute" : "Mute",
      image:
        Platform.OS === "ios"
          ? room.muted
            ? "bell"
            : "bell.slash"
          : room.muted
            ? "notifications"
            : "notifications_off",
    },
    ...(manages
      ? [
          {
            id: "archive",
            title: archived ? "Unarchive" : "Archive",
            image: Platform.OS === "ios" ? "archivebox" : "archive",
          },
        ]
      : []),
  ];
  return (
    <View className={cn("rounded-xl", selected && "bg-thread-selected")}>
      <Menu
        actions={actions}
        shouldOpenOnLongPress
        onPressAction={({ nativeEvent }) => {
          if (nativeEvent.event === "mute") void commands.setMuted(room.id, !room.muted);
          if (nativeEvent.event === "archive") void commands.setArchived(room.id, !archived);
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
