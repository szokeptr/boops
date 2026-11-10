import type { LegendListRef } from "@legendapp/list/react";
import { joinRoomMessages } from "@t3tools/client-runtime/state/rooms";
import {
  type EnvironmentId,
  MessageId,
  type ProjectAvatar,
  type ProjectId,
  type RoomId,
  type RoomMessage,
  roomParticipantKey,
  type ThreadId,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { useTheme } from "~/hooks/useTheme";
import type { TimelineEntry } from "~/session-logic";
import type { ChatMessage } from "~/types";
import { roomEnvironment, useRoomFeed } from "../../state/rooms";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { ExpandedImageDialogHost, openExpandedImagePreview } from "../chat/ExpandedImageDialog";
import { MessagesTimeline, type MessagesTimelineHistoryControls } from "../chat/MessagesTimeline";
import { ScrollToEndButton } from "../chat/TimelineOverlays";
import { useTimelineFollow } from "../chat/useTimelineFollow";

export interface RoomBot {
  readonly projectId: ProjectId;
  readonly name: string;
  readonly avatar: ProjectAvatar | null;
  /** The viewer's own conversation with the bot, which its name in the chat opens. */
  readonly threadId: ThreadId | null;
}

// The room's summary, and so its bot list, is rebuilt on every message; the timeline's rows all
// re-render when the names they read change identity.
const mentionNamesByKey = new Map<string, ReadonlyArray<string>>();
function stableMentionNames(bots: ReadonlyArray<RoomBot>): ReadonlyArray<string> {
  const names = bots.map((bot) => bot.name);
  const key = names.join("\n");
  const cached = mentionNamesByKey.get(key);
  if (cached !== undefined) return cached;
  mentionNamesByKey.set(key, names);
  return names;
}

const NO_TURN_DIFFS: ReadonlyArray<never> = [];
const NO_RUNS: ReadonlyArray<never> = [];
const ignore = () => {};

/**
 * A room message as the thread timeline draws it: your own on your side, everyone else's (people,
 * bots and the room's own notes) on the other, under their name.
 */
function roomTimelineEntry(
  message: RoomMessage,
  myKey: string,
  bot: RoomBot | null,
): TimelineEntry {
  const key = roomParticipantKey(message.author);
  const base = {
    id: MessageId.make(`room:${message.id}`),
    text: message.text,
    attachments: message.attachments,
    runId: null,
    streaming: false,
    createdAt: message.createdAt,
    updatedAt: message.createdAt,
  };
  const author = message.author;
  const chatMessage: ChatMessage =
    key === myKey
      ? { ...base, role: "user" }
      : {
          ...base,
          role: "assistant",
          sender: {
            key,
            name: message.authorName,
            ...(author.kind === "bot"
              ? { bot: { avatar: bot?.avatar ?? null, threadId: bot?.threadId ?? null } }
              : {}),
            ...(author.kind === "system" ? { notice: true } : {}),
          },
        };
  return {
    id: chatMessage.id,
    kind: "message",
    createdAt: message.createdAt,
    message: chatMessage,
  };
}

interface CachedEntry {
  readonly myKey: string;
  readonly bot: RoomBot | null;
  readonly entry: TimelineEntry;
}
// Feed messages keep their identity, so each entry is built once and the timeline's rows stay
// the same objects while new messages arrive.
const entryCache = new WeakMap<RoomMessage, CachedEntry>();

function cachedRoomTimelineEntry(
  message: RoomMessage,
  myKey: string,
  bots: ReadonlyArray<RoomBot>,
): TimelineEntry {
  const author = message.author;
  const bot =
    author.kind === "bot"
      ? (bots.find((candidate) => candidate.projectId === author.projectId) ?? null)
      : null;
  const cached = entryCache.get(message);
  if (
    cached !== undefined &&
    cached.myKey === myKey &&
    cached.bot?.avatar === bot?.avatar &&
    cached.bot?.threadId === bot?.threadId
  ) {
    return cached.entry;
  }
  const entry = roomTimelineEntry(message, myKey, bot);
  entryCache.set(message, { myKey, bot, entry });
  return entry;
}

/** A room's messages in the thread timeline, live, with earlier pages on demand. */
export function RoomTimeline(props: {
  readonly environmentId: EnvironmentId;
  readonly roomId: RoomId;
  readonly bots: ReadonlyArray<RoomBot>;
  readonly myKey: string;
  readonly working: ReadonlyArray<RoomBot>;
}) {
  const { environmentId, roomId } = props;
  // No ":" so the timeline finds no environment thread behind the key.
  const roomKey = `room-${roomId}`;
  const listRef = useRef<LegendListRef | null>(null);
  const { resolvedTheme } = useTheme();
  const navigate = useNavigate();
  const feed = useRoomFeed(environmentId, roomId).data;
  const loadHistory = useAtomCommand(roomEnvironment.history, { reportFailure: false });
  const [older, setOlder] = useState<{
    readonly messages: ReadonlyArray<RoomMessage>;
    readonly hasOlder: boolean;
  } | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  const joined = feed === null ? null : joinRoomMessages(older, feed);
  const messages = joined?.messages ?? [];
  const entries = messages.map((message) =>
    cachedRoomTimelineEntry(message, props.myKey, props.bots),
  );
  const isWorking = props.working.length > 0;
  const follow = useTimelineFollow({
    legendListRef: listRef,
    composerTimelineInset: 0,
    routeThreadKey: roomKey,
    activeThreadKey: roomKey,
    // Not a server thread: new messages follow the end instead of anchoring near the top.
    isServerThread: false,
    serverProjection: null,
    threadStatus: "live",
    activeActivityRun: null,
    activeRunningTurnId: null,
    timelineEntries: entries,
    timelineAnchorMessageId: null,
    setTimelineAnchor: ignore,
  });
  const loadEarlier = useStableCallback(async () => {
    const first = messages[0];
    if (first === undefined || loadingOlder) return;
    setLoadingOlder(true);
    const result = await loadHistory({ environmentId, input: { roomId, beforeSeq: first.seq } });
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
  });
  const markRead = useAtomCommand(roomEnvironment.markRead, { reportFailure: false });
  const newestSeq = feed?.messages.at(-1)?.seq ?? null;
  const atEnd = !follow.showScrollToBottom;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tells the server what this person has seen, while the room is in front of them and scrolled to the end
  useEffect(() => {
    if (newestSeq === null || !atEnd) return;
    const report = () => {
      if (document.visibilityState !== "visible" || !document.hasFocus()) return;
      void markRead({ environmentId, input: { roomId, throughSeq: newestSeq } });
    };
    report();
    document.addEventListener("visibilitychange", report);
    window.addEventListener("focus", report);
    return () => {
      document.removeEventListener("visibilitychange", report);
      window.removeEventListener("focus", report);
    };
  }, [environmentId, roomId, newestSeq, atEnd, markRead]);
  const hasMoreHistory = joined?.hasOlder ?? false;
  // Without earlier pages to offer, a new room shows the timeline's empty placeholder.
  const historyControls: MessagesTimelineHistoryControls | undefined =
    hasMoreHistory || loadingOlder || olderError !== null
      ? {
          hasMoreHistory,
          loading: loadingOlder,
          error: olderError,
          onLoadEarlier: () => void loadEarlier(),
        }
      : undefined;
  const openThread = (threadId: ThreadId) =>
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams({ environmentId, threadId }),
    });

  return (
    <div className="relative min-h-0 flex-1">
      <MessagesTimeline
        listRef={listRef}
        timelineEntries={entries}
        directMessage
        mentionNames={stableMentionNames(props.bots)}
        isWorking={isWorking}
        typingName={isWorking ? props.working.map((bot) => bot.name).join(", ") : null}
        activeTurnStartedAt={null}
        latestRun={null}
        runningRunId={null}
        turnDiffSummaries={NO_TURN_DIFFS}
        runs={NO_RUNS}
        routeThreadKey={roomKey}
        onOpenThread={openThread}
        supportsConversationRollback={false}
        onRevertToTurnCount={ignore}
        isRevertingCheckpoint={false}
        onImageExpand={(preview) => openExpandedImagePreview(roomKey, preview)}
        historyControls={historyControls}
        hideEmptyPlaceholder={feed === null}
        activeThreadEnvironmentId={environmentId}
        markdownCwd={undefined}
        resolvedTheme={resolvedTheme}
        timestampFormat="locale"
        workspaceRoot={undefined}
        anchorMessageId={null}
        onAnchorReady={ignore}
        onAnchorSizeChanged={ignore}
        contentInsetEndAdjustment={0}
        emptyPlaceholderInset={0}
        liveFollowEnabled={follow.timelineLiveFollowEnabled}
        onIsAtEndChange={follow.onIsAtEndChangeStable}
        onViewportAttach={follow.attachTimelineViewport}
      />
      {follow.showScrollToBottom ? (
        <ScrollToEndButton
          summary={null}
          bottom={4}
          onScrollToEnd={() => follow.scrollToEnd(true)}
        />
      ) : null}
      <ExpandedImageDialogHost threadKey={roomKey} />
    </div>
  );
}
