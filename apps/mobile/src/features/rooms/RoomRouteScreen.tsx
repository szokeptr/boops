import { useKeyboardChatComposerInset, useKeyboardScrollToEnd } from "@legendapp/list/keyboard";
import type { LegendListRef } from "@legendapp/list/react-native";
import { joinRoomMessages } from "@t3tools/client-runtime/state/rooms";
import {
  EnvironmentId,
  type RoomMessage,
  type RoomParticipant,
  roomParticipantKey,
  RoomId,
  type RoomSummary,
  ThreadId,
} from "@t3tools/contracts";
import {
  StackActions,
  useIsFocused,
  useNavigation,
  type StaticScreenProps,
} from "@react-navigation/native";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  AppState,
  Platform,
  ScrollView,
  useWindowDimensions,
  View,
  type ViewInstance,
} from "react-native";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { AppBar } from "../../components/ui/AppBar";
import type { AppBarMenuItem } from "../../components/ui/AppBar.types";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { EmptyState } from "../../components/ui/EmptyState";
import { ANDROID_READING_MAX_WIDTH, CHAT_CONTENT_MAX_WIDTH } from "../../lib/layout";
import { MarkdownMentionNamesContext } from "../../native/MarkdownMentionNamesContext";
import { NATIVE_LIQUID_GLASS_SUPPORTED } from "../../native/native-glass";
import { environmentCatalog } from "../../connection/catalog";
import { useProjects } from "../../state/entities";
import { useEnvironmentMembers } from "../../state/members";
import { useEnvironmentPresentation } from "../../state/presentation";
import { roomEnvironment, useRoomFeed, useRooms } from "../../state/rooms";
import { useAtomCommand } from "../../state/use-atom-command";
import { EnvironmentConnectionNotice } from "../connection/EnvironmentConnectionNotice";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import { threadHeaderAppearance } from "../threads/thread-header-appearance";
import { ThreadFeed, type ThreadFeedHistoryControls } from "../threads/ThreadFeed";
import { useOpenLinkedThread } from "../threads/useOpenLinkedThread";
import { RoomAvatar } from "./RoomAvatar";
import { RoomComposer } from "./RoomComposer";
import { RoomRequestCard, type RoomRequestAnswer } from "./RoomRequestCard";
import {
  canManageRoom,
  type RoomBot,
  roomBots,
  roomFeedEntry,
  roomTypingName,
} from "./roomPresentation";
import { useRoomCommands, useRoomViewer } from "./useRoomCommands";

type RoomRouteScreenProps = StaticScreenProps<{
  readonly environmentId: string;
  readonly roomId: string;
}>;

const NO_QUEUED: ReadonlyArray<never> = [];
const NO_NAMES: ReadonlyArray<string> = [];
const READY = { kind: "ready" } as const;
const LOADING = { kind: "loading" } as const;
const EMPTY_ROOM = {
  title: "No messages yet",
  detail: "Say hello, or type @ to ask one of the bots.",
};

/** A group chat: everyone's messages as bubbles, its bots' requests, and a composer. */
export function RoomRouteScreen(props: RoomRouteScreenProps) {
  const navigation = useNavigation();
  const environmentId = EnvironmentId.make(props.route.params.environmentId);
  const roomId = RoomId.make(props.route.params.roomId);
  const { rooms, loaded } = useRooms(environmentId);
  const environment = useEnvironmentPresentation(environmentId);
  const retryEnvironment = useAtomCommand(environmentCatalog.retryNow, "environment retry");
  const room = rooms.find((entry) => entry.id === roomId);
  if (room !== undefined && room.joined) {
    // Keyed so paging and the composer start fresh in each room, even one reusing this screen.
    return (
      <RoomScreen key={`${environmentId}:${room.id}`} environmentId={environmentId} room={room} />
    );
  }
  const connection = environment.presentation?.connection ?? null;
  const unknownEnvironment = environment.isReady && environment.presentation === null;
  return (
    <View className="flex-1 bg-screen">
      <AppBar
        title="Group chat"
        {...(navigation.canGoBack() ? { onBack: () => navigation.goBack() } : {})}
      />
      {loaded || unknownEnvironment ? (
        <View className="flex-1 items-center justify-center px-8">
          <EmptyState
            title="Group chat not found"
            detail="This group chat is gone, or you are not in it."
            variant="plain"
          />
        </View>
      ) : connection !== null && connection.phase !== "connected" ? (
        <EnvironmentConnectionNotice
          environmentLabel={environment.presentation?.entry.target.label ?? "Environment"}
          connection={connection}
          resourceName="group chat"
          onRetry={() => void retryEnvironment(environmentId)}
        />
      ) : (
        <View className="flex-1 items-center justify-center">
          <AppActivityIndicator size="small" colorClassName="accent-icon-muted" />
        </View>
      )}
    </View>
  );
}

function RoomHeaderTitle(props: {
  readonly room: RoomSummary;
  readonly viewerKey: string;
  readonly avatarOf: Parameters<typeof RoomAvatar>[0]["avatarOf"];
}) {
  const { room } = props;
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={`${room.title}, ${room.participants.map((entry) => entry.name).join(", ")}`}
      className="flex-row items-center gap-2"
    >
      <RoomAvatar
        participants={room.participants}
        viewerKey={props.viewerKey}
        avatarOf={props.avatarOf}
        size={32}
      />
      <View className="shrink">
        <View className="flex-row items-center gap-1">
          <Text className="shrink font-t3-bold text-base text-foreground" numberOfLines={1}>
            {room.title}
          </Text>
          {room.muted ? (
            <SymbolView
              name="bell.slash.fill"
              size={11}
              tintColorClassName="accent-foreground-muted"
              type="monochrome"
            />
          ) : null}
        </View>
        <Text className="text-xs text-foreground-muted" numberOfLines={1}>
          {room.participants.map((entry) => entry.name).join(", ")}
        </Text>
      </View>
    </View>
  );
}

function useRoomMenu(
  environmentId: EnvironmentId,
  room: RoomSummary,
  viewer: RoomParticipant,
  bots: ReadonlyArray<RoomBot>,
  working: ReadonlyArray<RoomBot>,
  commands: ReturnType<typeof useRoomCommands>,
) {
  const navigation = useNavigation();
  const openLinkedThread = useOpenLinkedThread();
  const projects = useProjects();
  const isOwner = viewer.kind === "owner";
  const { members } = useEnvironmentMembers(isOwner ? environmentId : null);
  const manages = canManageRoom(room, viewer);
  const { canListen } = useRooms(environmentId);
  const inRoom = new Set(room.participants.map((entry) => roomParticipantKey(entry.participant)));
  const viewerKey = roomParticipantKey(viewer);
  // A member's session sees only the bots shared with them, which are the ones they may add.
  const addableBots = projects.filter(
    (project) =>
      project.environmentId === environmentId &&
      !project.isScratch &&
      project.archivedAt == null &&
      !inRoom.has(roomParticipantKey({ kind: "bot", projectId: project.id })),
  );
  const addablePeople = members.filter(
    (member) => !inRoom.has(roomParticipantKey({ kind: "member", memberId: member.id })),
  );
  const others = room.participants.filter(
    (entry) => roomParticipantKey(entry.participant) !== viewerKey,
  );
  const leaveScreen = () =>
    navigation.canGoBack()
      ? navigation.goBack()
      : navigation.dispatch(StackActions.replace("Home"));
  const botChats = bots.flatMap((bot) =>
    bot.threadId === null ? [] : [{ ...bot, threadId: bot.threadId }],
  );
  const items: AppBarMenuItem[] = [
    ...working.map((bot) => ({
      id: `stop:${bot.projectId}`,
      title: `Stop ${bot.name}`,
      icon: "stop.fill",
      onPress: () => void commands.stop(room.id, bot),
    })),
    ...(botChats.length > 0
      ? [
          {
            id: "bot-chat",
            title: "Your chat with",
            icon: "bubble.left",
            items: botChats.map((bot) => ({
              id: `bot-chat:${bot.projectId}`,
              title: bot.name,
              onPress: () => openLinkedThread({ environmentId, threadId: bot.threadId }),
            })),
          },
        ]
      : []),
    ...(manages && addableBots.length > 0
      ? [
          {
            id: "add-bot",
            title: "Add a bot",
            icon: "plus",
            items: addableBots.map((bot) => ({
              id: `add-bot:${bot.id}`,
              title: bot.title,
              onPress: () => void commands.add(room.id, { kind: "bot", projectId: bot.id }),
            })),
          },
        ]
      : []),
    ...(manages && isOwner && addablePeople.length > 0
      ? [
          {
            id: "add-person",
            title: "Add a person",
            icon: "person.badge.plus",
            items: addablePeople.map((member) => ({
              id: `add-person:${member.id}`,
              title: member.label,
              onPress: () => void commands.add(room.id, { kind: "member", memberId: member.id }),
            })),
          },
        ]
      : []),
    ...(manages && others.length > 0
      ? [
          {
            id: "take-out",
            title: "Take out",
            icon: "person.fill.xmark",
            items: others.map((entry) => ({
              id: `take-out:${roomParticipantKey(entry.participant)}`,
              title: entry.name,
              onPress: () => commands.remove(room.id, entry.participant, entry.name),
            })),
          },
        ]
      : []),
    ...(manages && bots.length > 0
      ? [
          {
            id: "chiming-in",
            title: "Bots chiming in",
            icon: "sparkles",
            items: [
              ...(canListen
                ? []
                : [
                    {
                      id: "chiming-in:unavailable",
                      title: isOwner
                        ? "Add an OpenAI API key in Providers settings on desktop"
                        : "The owner hasn't set this up yet",
                      disabled: true,
                      onPress: () => {},
                    },
                  ]),
              ...bots.map((bot) => {
                const entry = room.participants.find(
                  (participant) =>
                    participant.participant.kind === "bot" &&
                    participant.participant.projectId === bot.projectId,
                );
                const listening = entry?.listening ?? false;
                const listensFor = entry?.listensFor ?? null;
                return {
                  id: `chiming-in:${bot.projectId}`,
                  title: bot.name,
                  items: [
                    {
                      id: `chiming-in:${bot.projectId}:toggle`,
                      title: "Chimes in without @mention",
                      selected: listening,
                      onPress: () =>
                        void commands.setListening(room.id, bot.projectId, !listening, listensFor),
                    },
                    ...(listening
                      ? [
                          {
                            id: `chiming-in:${bot.projectId}:for`,
                            title: "Here for…",
                            ...(listensFor === null ? {} : { subtitle: listensFor }),
                            onPress: () => commands.editListensFor(room.id, bot, listensFor),
                          },
                        ]
                      : []),
                  ],
                };
              }),
            ],
          },
        ]
      : []),
    ...(manages
      ? [
          {
            id: "rename",
            title: "Rename…",
            icon: "pencil",
            onPress: () => commands.rename(room.id, room.title),
          },
        ]
      : []),
    {
      id: "mute",
      title: room.muted ? "Unmute" : "Mute",
      icon: room.muted ? "bell" : "bell.slash",
      onPress: () => void commands.setMuted(room.id, !room.muted),
    },
    ...(manages
      ? [
          {
            id: "archive",
            title: room.archivedAt === null ? "Archive" : "Unarchive",
            icon: "archivebox",
            onPress: () => void commands.setArchived(room.id, room.archivedAt === null),
          },
        ]
      : []),
    {
      id: "leave",
      title: "Leave",
      icon: "rectangle.portrait.and.arrow.right",
      onPress: () => commands.leave(room.id, room.title, leaveScreen),
    },
    ...(manages
      ? [
          {
            id: "delete",
            title: "Delete…",
            icon: "trash",
            onPress: () => commands.delete(room.id, room.title, leaveScreen),
          },
        ]
      : []),
  ];
  return items;
}

function RoomScreen(props: { readonly environmentId: EnvironmentId; readonly room: RoomSummary }) {
  const { environmentId, room } = props;
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { layout } = useAdaptiveWorkspaceLayout();
  const { viewer, viewerKey, avatarOf, threadOf } = useRoomViewer(environmentId);
  const bots = roomBots(room.participants, avatarOf, threadOf);
  // Derived from a string so the compiler keeps the same list, and the feed's rows, while only
  // the room's other details change.
  const mentionNamesKey = bots.map((bot) => bot.name).join("\0");
  const mentionNames = mentionNamesKey === "" ? NO_NAMES : mentionNamesKey.split("\0");
  const commands = useRoomCommands(environmentId);
  const feed = useRoomFeed(environmentId, room.id).data;
  const workingIds = feed?.working ?? room.working;
  const working =
    room.archivedAt === null ? bots.filter((bot) => workingIds.includes(bot.projectId)) : [];
  const menuItems = useRoomMenu(environmentId, room, viewer, bots, working, commands);
  const respond = useAtomCommand(roomEnvironment.respond, "Could not answer");
  const markRead = useAtomCommand(roomEnvironment.markRead, { reportFailure: false });
  const newestSeq = feed?.messages.at(-1)?.seq ?? null;
  const focused = useIsFocused();
  // useAtomCommand returns a new function every render, so it cannot be an effect dependency.
  const reportRead = useEffectEvent((throughSeq: number) => {
    if (AppState.currentState !== "active") return;
    void markRead({ environmentId, input: { roomId: room.id, throughSeq } });
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tells the server what this person has seen, while the room is on screen and the app in front
  useEffect(() => {
    if (newestSeq === null || !focused) return;
    reportRead(newestSeq);
    const subscription = AppState.addEventListener("change", () => reportRead(newestSeq));
    return () => subscription.remove();
  }, [newestSeq, focused]);
  const loadHistory = useAtomCommand(roomEnvironment.history, { reportFailure: false });
  const [older, setOlder] = useState<{
    readonly messages: ReadonlyArray<RoomMessage>;
    readonly hasOlder: boolean;
  } | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  const joined = feed === null ? null : joinRoomMessages(older, feed);
  const messages = joined?.messages ?? [];
  const entries = messages.map((message) => roomFeedEntry(message, viewerKey, bots));
  const requests = feed?.requests ?? [];
  // A bot waiting on someone is not typing.
  const typing = workingIds.filter(
    (projectId) => !requests.some((request) => request.projectId === projectId),
  );
  const typingName = roomTypingName(bots, typing);
  // The turn started with the last message, give or take; the row only seeds its wording from it.
  const typingSince = typingName === null ? null : (messages.at(-1)?.createdAt ?? room.createdAt);

  const loadEarlier = async () => {
    const first = messages[0];
    if (first === undefined || loadingOlder) return;
    setLoadingOlder(true);
    const result = await loadHistory({
      environmentId,
      input: { roomId: room.id, beforeSeq: first.seq },
    });
    setLoadingOlder(false);
    if (result._tag !== "Success") {
      setOlderError("Could not load earlier messages.");
      return;
    }
    setOlderError(null);
    setOlder({
      messages: [...result.value.messages, ...(joined?.olderUsed ? (older?.messages ?? []) : [])],
      hasOlder: result.value.hasOlder,
    });
  };
  const historyControls: ThreadFeedHistoryControls = {
    hasMoreHistory: joined?.hasOlder ?? false,
    loading: loadingOlder,
    error: olderError,
    onLoadEarlier: () => void loadEarlier(),
    onLoadThrough: () => void loadEarlier(),
  };

  const listRef = useRef<LegendListRef>(null);
  const composerOverlayRef = useRef<ViewInstance>(null);
  const { freeze } = useKeyboardScrollToEnd({ listRef });
  const [overlayHeight, setOverlayHeight] = useState(0);
  const composerBottomInset = Math.max(insets.bottom, 12);
  const nativeInsetOvercount =
    NATIVE_LIQUID_GLASS_SUPPORTED && Platform.OS === "ios" ? insets.bottom : 0;
  const { contentInsetEndAdjustment, onComposerLayout } = useKeyboardChatComposerInset(
    listRef,
    composerOverlayRef,
    Math.max(0, overlayHeight - nativeInsetOvercount),
    -nativeInsetOvercount,
    0,
  );
  const isSplitLayout = layout.variant !== "compact";
  const contentMaxWidth =
    Platform.OS === "android"
      ? ANDROID_READING_MAX_WIDTH
      : isSplitLayout
        ? CHAT_CONTENT_MAX_WIDTH
        : undefined;
  const threadId = ThreadId.make(`room-${room.id}`);
  const subtitle = room.participants.map((entry) => entry.name).join(", ");

  const answer = async (
    request: (typeof requests)[number],
    response: RoomRequestAnswer,
  ): Promise<boolean> => {
    const result = await respond({
      environmentId,
      input: {
        roomId: room.id,
        projectId: request.projectId,
        requestId: request.requestId,
        ...response,
      },
    });
    return result._tag === "Success";
  };

  return (
    <View className="flex-1 bg-screen">
      <AppBar
        title={room.title}
        subtitle={Platform.OS === "android" ? subtitle : null}
        menus={[{ title: "Group chat options", icon: "ellipsis", items: menuItems }]}
        {...(navigation.canGoBack() ? { onBack: () => navigation.goBack() } : {})}
        options={
          Platform.OS === "ios"
            ? {
                ...threadHeaderAppearance(NATIVE_LIQUID_GLASS_SUPPORTED),
                // oxlint-disable-next-line react/no-unstable-nested-components -- React Navigation invokes headerTitle as a render callback.
                headerTitle: () => (
                  <RoomHeaderTitle room={room} viewerKey={viewerKey} avatarOf={avatarOf} />
                ),
              }
            : undefined
        }
        optionsVersion={[
          room.title,
          room.muted,
          subtitle,
          menuItems.length,
          room.archivedAt,
          bots.map((bot) => bot.threadId).join(","),
          working.map((bot) => bot.name).join(","),
        ]}
      />
      <MarkdownMentionNamesContext value={mentionNames}>
        <ThreadFeed
          environmentId={environmentId}
          threadId={threadId}
          detailRef={null}
          threadTitle={room.title}
          feed={entries}
          contentPresentation={feed === null ? LOADING : READY}
          emptyPlaceholder={EMPTY_ROOM}
          latestRun={null}
          activeWorkStartedAt={null}
          directMessage={{
            typingSince,
            typingName,
            ownBubble: null,
            bot: { name: room.title, avatar: null },
            parentProjectId: null,
          }}
          queuedMessages={NO_QUEUED}
          dispatchingMessageId={null}
          onEditPendingMessage={null}
          onEditSentMessage={null}
          onCite={null}
          listRef={listRef}
          freeze={freeze}
          anchorMessageId={null}
          contentInsetEndAdjustment={contentInsetEndAdjustment}
          keyboardOffset={composerBottomInset}
          contentTopInset={0}
          contentBottomInset={overlayHeight}
          contentMaxWidth={contentMaxWidth}
          historyControls={historyControls}
          layoutVariant={layout.variant}
          usesAutomaticContentInsets={NATIVE_LIQUID_GLASS_SUPPORTED}
        />
      </MarkdownMentionNamesContext>
      {feed === null ? (
        <View pointerEvents="none" className="absolute inset-0 items-center justify-center">
          <AppActivityIndicator size="small" colorClassName="accent-icon-muted" />
        </View>
      ) : null}
      <KeyboardStickyView
        pointerEvents="box-none"
        style={{ position: "absolute", bottom: 0, left: 0, right: 0, top: 0 }}
        offset={{ closed: 0, opened: composerBottomInset }}
      >
        <View
          pointerEvents="box-none"
          style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}
        >
          <View
            ref={composerOverlayRef}
            onLayout={(event) => {
              onComposerLayout(event);
              setOverlayHeight(event.nativeEvent.layout.height);
            }}
            className="w-full"
          >
            {requests.length > 0 ? (
              <ScrollView
                className="w-full grow-0 self-center"
                style={{ maxWidth: contentMaxWidth, maxHeight: windowHeight * 0.45 }}
                contentContainerClassName="gap-3 px-4 pb-3"
                keyboardShouldPersistTaps="handled"
              >
                {requests.map((request) => (
                  <RoomRequestCard
                    key={`${request.projectId}:${request.requestId}`}
                    request={request}
                    bot={bots.find((bot) => bot.projectId === request.projectId)}
                    onRespond={(response) => answer(request, response)}
                  />
                ))}
              </ScrollView>
            ) : null}
            {room.archivedAt === null ? (
              <RoomComposer
                environmentId={environmentId}
                roomId={room.id}
                roomTitle={room.title}
                bots={bots}
                working={working}
                onStop={(bot) => void commands.stop(room.id, bot)}
                bottomInset={composerBottomInset}
                contentMaxWidth={contentMaxWidth}
              />
            ) : (
              <Text
                className="py-3 text-center text-sm text-foreground-muted"
                style={{ paddingBottom: composerBottomInset + 6 }}
              >
                This group chat is archived.
              </Text>
            )}
          </View>
        </View>
      </KeyboardStickyView>
    </View>
  );
}
