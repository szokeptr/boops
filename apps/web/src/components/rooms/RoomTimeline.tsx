import type { LegendListRef } from "@legendapp/list/react";
import {
  type EnvironmentId,
  MessageId,
  type ProjectAvatar,
  type ProjectId,
  type RoomId,
  type RoomMessage,
  roomParticipantKey,
} from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { useTheme } from "~/hooks/useTheme";
import type { TimelineEntry } from "~/session-logic";
import type { ChatMessage } from "~/types";
import { roomEnvironment, useRoomFeed } from "../../state/rooms";
import { useAtomCommand } from "../../state/use-atom-command";
import type { ExpandedImagePreview } from "../chat/ExpandedImagePreview";
import { MessagesTimeline, type MessagesTimelineHistoryControls } from "../chat/MessagesTimeline";
import { ScrollToEndButton } from "../chat/TimelineOverlays";
import { useTimelineFollow } from "../chat/useTimelineFollow";

export interface RoomBot {
  readonly projectId: ProjectId;
  readonly name: string;
  readonly avatar: ProjectAvatar | null;
}

const NO_TURN_DIFFS: ReadonlyArray<never> = [];
const NO_RUNS: ReadonlyArray<never> = [];
const ignore = () => {};
const openExpandedImage = (preview: ExpandedImagePreview) => {
  const src = preview.images[preview.index]?.src;
  if (src) window.open(src, "_blank", "noopener,noreferrer");
};

/**
 * A room message as the thread timeline draws it: your own on your side, everyone else's (people,
 * bots and the room's own notes) on the other, under their name.
 */
function roomTimelineEntry(
  message: RoomMessage,
  myKey: string,
  bots: ReadonlyArray<RoomBot>,
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
  const bot =
    author.kind === "bot"
      ? bots.find((candidate) => candidate.projectId === author.projectId)
      : null;
  const chatMessage: ChatMessage =
    key === myKey
      ? { ...base, role: "user" }
      : {
          ...base,
          role: "assistant",
          sender: {
            key,
            name: message.authorName,
            ...(author.kind === "bot" ? { bot: { avatar: bot?.avatar ?? null } } : {}),
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
  const feed = useRoomFeed(environmentId, roomId).data;
  const loadHistory = useAtomCommand(roomEnvironment.history, { reportFailure: false });
  const [older, setOlder] = useState<{
    readonly messages: ReadonlyArray<RoomMessage>;
    readonly hasOlder: boolean;
  } | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  const messages = [...(older?.messages ?? []), ...(feed?.messages ?? [])];
  const entries = messages.map((message) => roomTimelineEntry(message, props.myKey, props.bots));
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
      messages: [...result.value.messages, ...(older?.messages ?? [])],
      hasOlder: result.value.hasOlder,
    });
  });
  const markRead = useAtomCommand(roomEnvironment.markRead, { reportFailure: false });
  const newestSeq = feed?.messages.at(-1)?.seq ?? null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tells the server what this person has seen, while the room is on screen
  useEffect(() => {
    if (newestSeq === null) return;
    const report = () => {
      if (document.visibilityState !== "visible") return;
      void markRead({ environmentId, input: { roomId, throughSeq: newestSeq } });
    };
    report();
    document.addEventListener("visibilitychange", report);
    return () => document.removeEventListener("visibilitychange", report);
  }, [environmentId, roomId, newestSeq, markRead]);
  const historyControls: MessagesTimelineHistoryControls = {
    hasMoreHistory: older === null ? (feed?.hasOlder ?? false) : older.hasOlder,
    loading: loadingOlder,
    error: olderError,
    onLoadEarlier: () => void loadEarlier(),
  };

  return (
    <div className="relative min-h-0 flex-1">
      <MessagesTimeline
        listRef={listRef}
        timelineEntries={entries}
        directMessage
        isWorking={isWorking}
        typingName={isWorking ? props.working.map((bot) => bot.name).join(", ") : null}
        activeTurnStartedAt={null}
        latestRun={null}
        runningRunId={null}
        turnDiffSummaries={NO_TURN_DIFFS}
        runs={NO_RUNS}
        routeThreadKey={roomKey}
        onOpenThread={ignore}
        supportsConversationRollback={false}
        onRevertToTurnCount={ignore}
        isRevertingCheckpoint={false}
        onImageExpand={openExpandedImage}
        historyControls={historyControls}
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
    </div>
  );
}
