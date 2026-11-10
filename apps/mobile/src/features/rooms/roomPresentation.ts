import { isTransportConnectionErrorMessage } from "@t3tools/client-runtime/errors";
import { botMessagePreview } from "@t3tools/client-runtime/state/bot-list";
import {
  EnvironmentMemberId,
  MessageId,
  type ProjectAvatar,
  type ProjectId,
  type ProviderApprovalOption,
  ROOM_APPROVAL_DECISIONS,
  type RoomMessage,
  type RoomParticipant,
  roomParticipantKey,
  type RoomParticipantView,
  RoomsError,
  type RoomSummary,
  ThreadId,
} from "@t3tools/contracts";

import type { ThreadFeedEntry } from "../../lib/threadActivity";

export interface RoomBot {
  readonly projectId: ProjectId;
  readonly name: string;
  readonly avatar: ProjectAvatar | null;
  /** The viewer's own conversation with the bot, which its name in the chat opens. */
  readonly threadId: ThreadId | null;
}

/** The viewer as a room participant: the owner, or the member this session belongs to. */
export function roomViewer(sessionMemberId: string | null): RoomParticipant {
  return sessionMemberId === null
    ? { kind: "owner" }
    : { kind: "member", memberId: EnvironmentMemberId.make(sessionMemberId) };
}

/** Owners and a room's creator manage it; everyone else may only mute and leave. */
export function canManageRoom(room: RoomSummary, viewer: RoomParticipant): boolean {
  return (
    viewer.kind === "owner" || roomParticipantKey(room.createdBy) === roomParticipantKey(viewer)
  );
}

/** The room's bots, with each one's picture and conversation when this session can see it. */
export function roomBots(
  participants: ReadonlyArray<RoomParticipantView>,
  avatarOf: (projectId: ProjectId) => ProjectAvatar | null,
  threadOf: (projectId: ProjectId) => ThreadId | null,
): ReadonlyArray<RoomBot> {
  return participants.flatMap((entry) =>
    entry.participant.kind === "bot"
      ? [
          {
            projectId: entry.participant.projectId,
            name: entry.name,
            avatar: avatarOf(entry.participant.projectId),
            threadId: threadOf(entry.participant.projectId),
          },
        ]
      : [],
  );
}

const roomFeedMessages = new WeakMap<RoomMessage, { key: string; entry: ThreadFeedEntry }>();

/**
 * A room message as a bot conversation draws it: your own on your side, everyone else's (people,
 * bots and the room's own notes) on the other, under their name.
 */
export function roomFeedEntry(
  message: RoomMessage,
  viewerKey: string,
  bots: ReadonlyArray<RoomBot>,
): ThreadFeedEntry {
  const key = roomParticipantKey(message.author);
  const author = message.author;
  const bot =
    author.kind === "bot"
      ? bots.find((candidate) => candidate.projectId === author.projectId)
      : null;
  // Reuse the entry while nothing it shows changed, so the list keeps its rows.
  const cacheKey = `${viewerKey}\n${bot?.threadId ?? ""}\n${bot?.avatar ? JSON.stringify(bot.avatar) : ""}`;
  const cached = roomFeedMessages.get(message);
  if (cached?.key === cacheKey) return cached.entry;
  const id = MessageId.make(`room:${message.id}`);
  const entry: ThreadFeedEntry = {
    type: "message",
    id,
    createdAt: message.createdAt,
    message: {
      id,
      role: key === viewerKey ? "user" : "assistant",
      text: message.text,
      attachments: message.attachments,
      runId: null,
      streaming: false,
      visibility: "local",
      sourceThreadId: ThreadId.make(`room-${message.roomId}`),
      createdAt: message.createdAt,
      updatedAt: message.createdAt,
      ...(key === viewerKey
        ? {}
        : {
            sender: {
              key,
              name: message.authorName,
              ...(author.kind === "bot"
                ? { bot: { avatar: bot?.avatar ?? null, threadId: bot?.threadId ?? null } }
                : {}),
              ...(author.kind === "system" ? { notice: true as const } : {}),
            },
          }),
    },
  };
  roomFeedMessages.set(message, { key: cacheKey, entry });
  return entry;
}

const CONNECTION_FAILURE = "Check the connection and try again.";

/** Why a post did not land: the room's own refusal, or the connection for transport failures. */
export function roomPostFailure(error: unknown): string {
  if (error instanceof RoomsError) return error.message;
  if (
    !(error instanceof Error) ||
    ("_tag" in error && error._tag === "RpcClientError") ||
    isTransportConnectionErrorMessage(error.message)
  ) {
    return CONNECTION_FAILURE;
  }
  return error.message;
}

/** The second line of a room's row: who is answering, or the last thing said. */
export function roomRowSubtitle(room: RoomSummary, viewerKey: string): string {
  if (room.working.length > 0) return "Answering…";
  const last = room.lastMessage;
  if (last === null) return `${room.participants.length} in the chat`;
  const preview =
    botMessagePreview(last.text) ?? (last.attachments.length > 0 ? "Sent an attachment" : "");
  if (last.author.kind === "system") return preview;
  const author = roomParticipantKey(last.author) === viewerKey ? "You" : last.authorName;
  return `${author}: ${preview}`;
}

// An allow-for-session from one person could carry into a turn someone else starts.
const ROOM_FALLBACK_APPROVAL_OPTIONS: ReadonlyArray<ProviderApprovalOption> = [
  { decision: "accept", label: "Allow once" },
  { decision: "decline", label: "Decline" },
];

/** An approval's buttons: the provider's own choices a room accepts, else Allow once and Decline. */
export function roomApprovalOptions(
  options: ReadonlyArray<ProviderApprovalOption> | undefined,
): ReadonlyArray<ProviderApprovalOption> {
  const allowed = (options ?? []).filter((option) => ROOM_APPROVAL_DECISIONS.has(option.decision));
  return allowed.length > 0 ? allowed : ROOM_FALLBACK_APPROVAL_OPTIONS;
}

/**
 * The faces a group avatar shows: a bot and a person when the room has both, else two people.
 * The person is someone else, or the viewer when they are the room's only person.
 */
export function roomAvatarFaces(
  participants: ReadonlyArray<RoomParticipantView>,
  viewerKey: string,
): ReadonlyArray<RoomParticipantView> {
  const bots = participants.filter((entry) => entry.participant.kind === "bot");
  const people = participants
    .filter((entry) => entry.participant.kind !== "bot")
    .sort(
      (a, b) =>
        Number(roomParticipantKey(a.participant) === viewerKey) -
        Number(roomParticipantKey(b.participant) === viewerKey),
    );
  return bots[0] === undefined ? people.slice(0, 2) : [bots[0], ...people.slice(0, 1)];
}

/** Names typed in the typing row: "Scout" or "Scout, Chef". */
export function roomTypingName(
  bots: ReadonlyArray<RoomBot>,
  working: ReadonlyArray<ProjectId>,
): string | null {
  const names = bots.filter((bot) => working.includes(bot.projectId)).map((bot) => bot.name);
  return names.length === 0 ? null : names.join(", ");
}

/** `@partial` right before the caret: the bots whose names start with it are offered. */
const MENTION_QUERY = /(?:^|\s)@([\p{L}\p{N}_-]*)$/u;

/** The `@` being typed at the caret, and where it starts. */
export function roomMentionQuery(
  text: string,
  cursor: number,
): { readonly query: string; readonly start: number } | null {
  const match = MENTION_QUERY.exec(text.slice(0, cursor));
  if (match === null) return null;
  const query = match[1] ?? "";
  return { query, start: cursor - query.length - 1 };
}

/** Replaces the `@partial` at the caret with `@Name `. */
export function insertRoomMention(
  text: string,
  mention: { readonly start: number },
  cursor: number,
  name: string,
): { readonly text: string; readonly cursor: number } {
  const insert = `@${name} `;
  return {
    text: text.slice(0, mention.start) + insert + text.slice(cursor),
    cursor: mention.start + insert.length,
  };
}
