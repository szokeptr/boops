import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  RuntimeRequestId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ChatAttachment } from "./chatAttachment.ts";
import { OrchestrationV2UserInputQuestion } from "./orchestrationV2.ts";
import {
  ProviderApprovalDecision,
  ProviderApprovalOption,
  ProviderUserInputAnswers,
} from "./providerPolicy.ts";
import { EnvironmentMemberId } from "./members.ts";

/**
 * A room is a group chat on one environment: the owner, members and bots. Each bot answers in a
 * hidden thread of its own; see `docs/adr/0003-rooms-front-per-bot-threads.md`.
 */
export const RoomId = TrimmedNonEmptyString.pipe(Schema.brand("RoomId"));
export type RoomId = typeof RoomId.Type;

export const RoomMessageId = TrimmedNonEmptyString.pipe(Schema.brand("RoomMessageId"));
export type RoomMessageId = typeof RoomMessageId.Type;

const ROOM_TITLE_MAX_LENGTH = 80;
const ROOM_MESSAGE_MAX_LENGTH = 20_000;
/** Bot turns one human message can set off through bots mentioning bots. */
export const ROOM_BOT_HOP_LIMIT = 3;

export const RoomHuman = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("owner") }),
  Schema.Struct({ kind: Schema.Literal("member"), memberId: EnvironmentMemberId }),
]);
export type RoomHuman = typeof RoomHuman.Type;

export const RoomParticipant = Schema.Union([
  ...RoomHuman.members,
  Schema.Struct({ kind: Schema.Literal("bot"), projectId: ProjectId }),
]);
export type RoomParticipant = typeof RoomParticipant.Type;

/** A message's sender; `system` is the room itself, e.g. when bots pause. */
export const RoomAuthor = Schema.Union([
  ...RoomParticipant.members,
  Schema.Struct({ kind: Schema.Literal("system") }),
]);
export type RoomAuthor = typeof RoomAuthor.Type;

/** A stable string for a participant, used as a key in storage and on clients. */
export const roomParticipantKey = (participant: RoomAuthor): string => {
  switch (participant.kind) {
    case "owner":
    case "system":
      return participant.kind;
    case "member":
      return `member:${participant.memberId}`;
    case "bot":
      return `bot:${participant.projectId}`;
  }
};

export const RoomParticipantView = Schema.Struct({
  participant: RoomParticipant,
  /** The current name: the bot's title, the member's label, or the owner's. */
  name: TrimmedNonEmptyString,
});
export type RoomParticipantView = typeof RoomParticipantView.Type;

export const RoomMessage = Schema.Struct({
  id: RoomMessageId,
  roomId: RoomId,
  /** Increases by one per message in a room. */
  seq: NonNegativeInt,
  author: RoomAuthor,
  /** The sender's name when they sent it. */
  authorName: TrimmedNonEmptyString,
  text: Schema.String,
  /** Bots this message addressed; each takes a turn. */
  mentions: Schema.Array(ProjectId),
  /** Files and images sent with it; a bot that answers gets them too. */
  attachments: Schema.Array(ChatAttachment),
  createdAt: IsoDateTime,
});
export type RoomMessage = typeof RoomMessage.Type;

export const RoomSummary = Schema.Struct({
  id: RoomId,
  title: TrimmedNonEmptyString,
  createdBy: RoomHuman,
  participants: Schema.Array(RoomParticipantView),
  /** False for an owner's view of a room they are not in: title and people only. */
  joined: Schema.Boolean,
  muted: Schema.Boolean,
  archivedAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
  lastMessage: Schema.NullOr(RoomMessage),
  /** Bots taking a turn right now. */
  working: Schema.Array(ProjectId),
  /** A bot is waiting on this viewer: an approval or a question only they (or the owner) answer. */
  needsYou: Schema.Boolean,
  /** Someone else wrote since this viewer last read the room. */
  unread: Schema.Boolean,
});
export type RoomSummary = typeof RoomSummary.Type;

/** Someone the viewer may bring into a room: the owner and the members, by name. */
export const RoomPerson = Schema.Struct({ person: RoomHuman, name: TrimmedNonEmptyString });
export type RoomPerson = typeof RoomPerson.Type;

export const RoomsSnapshot = Schema.Struct({
  rooms: Schema.Array(RoomSummary),
  canCreate: Schema.Boolean,
  /** Empty for a member who may not start rooms: who else is invited stays the owner's. */
  people: Schema.Array(RoomPerson),
  /** Whether the owner has said what to call them; rooms ask once before the first one. */
  ownerNamed: Schema.Boolean,
});
export type RoomsSnapshot = typeof RoomsSnapshot.Type;

const RoomTitle = TrimmedNonEmptyString.check(Schema.isMaxLength(ROOM_TITLE_MAX_LENGTH));

export const RoomsCreateInput = Schema.Struct({
  title: RoomTitle,
  /** Other members to bring in; a member creating a room may name any member too. */
  memberIds: Schema.Array(EnvironmentMemberId),
  botProjectIds: Schema.Array(ProjectId),
  /** For a member's room: whether the owner is in it. The owner's own rooms always include them. */
  includeOwner: Schema.optionalKey(Schema.Boolean),
});
export type RoomsCreateInput = typeof RoomsCreateInput.Type;

export const RoomsRenameInput = Schema.Struct({ roomId: RoomId, title: RoomTitle });
export type RoomsRenameInput = typeof RoomsRenameInput.Type;

export const RoomsParticipantInput = Schema.Struct({
  roomId: RoomId,
  participant: RoomParticipant,
});
export type RoomsParticipantInput = typeof RoomsParticipantInput.Type;

export const RoomsRoomInput = Schema.Struct({ roomId: RoomId });
export type RoomsRoomInput = typeof RoomsRoomInput.Type;

export const RoomsInterruptInput = Schema.Struct({ roomId: RoomId, projectId: ProjectId });
export type RoomsInterruptInput = typeof RoomsInterruptInput.Type;

export const RoomsSetArchivedInput = Schema.Struct({ roomId: RoomId, archived: Schema.Boolean });
export type RoomsSetArchivedInput = typeof RoomsSetArchivedInput.Type;

export const RoomsMarkReadInput = Schema.Struct({
  roomId: RoomId,
  /** The newest message the viewer has seen. */
  throughSeq: NonNegativeInt,
});
export type RoomsMarkReadInput = typeof RoomsMarkReadInput.Type;

export const RoomsSetMutedInput = Schema.Struct({ roomId: RoomId, muted: Schema.Boolean });
export type RoomsSetMutedInput = typeof RoomsSetMutedInput.Type;

const ROOM_MESSAGE_MAX_ATTACHMENTS = 8;

export const RoomsPostInput = Schema.Struct({
  roomId: RoomId,
  /** Chosen by the client, so a retried post lands once. */
  messageId: RoomMessageId,
  /** May be empty when the message is only attachments. */
  text: Schema.String.check(Schema.isMaxLength(ROOM_MESSAGE_MAX_LENGTH)),
  mentions: Schema.Array(ProjectId),
  /** Uploaded through `attachments.createUploadUrl`; the room claims them on post. */
  attachments: Schema.optionalKey(
    Schema.Array(ChatAttachment).check(Schema.isMaxLength(ROOM_MESSAGE_MAX_ATTACHMENTS)),
  ),
});
export type RoomsPostInput = typeof RoomsPostInput.Type;

export const ROOM_HISTORY_PAGE_SIZE = 50;

export const RoomsHistoryInput = Schema.Struct({
  roomId: RoomId,
  /** Messages before this seq, newest last; omitted for the latest page. */
  beforeSeq: Schema.optionalKey(NonNegativeInt),
});
export type RoomsHistoryInput = typeof RoomsHistoryInput.Type;

export const RoomsHistory = Schema.Struct({
  messages: Schema.Array(RoomMessage),
  hasOlder: Schema.Boolean,
});
export type RoomsHistory = typeof RoomsHistory.Type;

/**
 * A bot waiting on someone in the room mid-turn: a tool approval or a question. The human whose
 * message started the turn may answer, and the owner always may.
 */
export const RoomPendingRequest = Schema.Struct({
  projectId: ProjectId,
  botName: TrimmedNonEmptyString,
  requestId: RuntimeRequestId,
  kind: Schema.Literals(["approval", "question"]),
  /** For an approval: what the bot wants to do, such as a command line. */
  prompt: Schema.NullOr(Schema.String),
  /** For an approval: command, file-change, permission and the like. */
  requestKind: Schema.String,
  /**
   * For an approval: the provider's own choices, those a room allows (once, decline, cancel).
   * Absent when the provider offers none; clients then show Allow and Decline.
   */
  options: Schema.optionalKey(Schema.Array(ProviderApprovalOption)),
  questions: Schema.Array(OrchestrationV2UserInputQuestion),
  /** Whose message started the turn the bot is asking in. */
  askedFor: RoomHuman,
  askedForName: TrimmedNonEmptyString,
  /** Whether this viewer may answer. */
  canAnswer: Schema.Boolean,
  createdAt: IsoDateTime,
});
export type RoomPendingRequest = typeof RoomPendingRequest.Type;

/** A room's live feed: its latest page, then every new message and change in who is working. */
export const RoomFeedItem = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("snapshot"), history: RoomsHistory }),
  Schema.Struct({ kind: Schema.Literal("message"), message: RoomMessage }),
  Schema.Struct({ kind: Schema.Literal("working"), working: Schema.Array(ProjectId) }),
  Schema.Struct({ kind: Schema.Literal("requests"), requests: Schema.Array(RoomPendingRequest) }),
]);

/** Decisions a room accepts. A grant for the session would carry into turns other people start. */
export const ROOM_APPROVAL_DECISIONS: ReadonlySet<ProviderApprovalDecision> = new Set([
  "accept",
  "decline",
  "cancel",
]);

export const RoomsRespondInput = Schema.Struct({
  roomId: RoomId,
  projectId: ProjectId,
  requestId: RuntimeRequestId,
  /** For an approval; one of `ROOM_APPROVAL_DECISIONS`. */
  decision: Schema.optionalKey(ProviderApprovalDecision),
  /** For a question: answers by question id. */
  answers: Schema.optionalKey(ProviderUserInputAnswers),
});
export type RoomsRespondInput = typeof RoomsRespondInput.Type;
export type RoomFeedItem = typeof RoomFeedItem.Type;

const ROOMS_ERROR_MESSAGES = {
  "not-found": "That room does not exist, or you are not in it.",
  "not-allowed": "You can't do that in this room.",
  "bot-not-shared": "You can only add bots shared with you.",
  "not-a-member": "Only people already invited to this machine can join a room.",
  "empty-message": "Write something or attach a file.",
  "attachment-failed": "Could not attach that file. Try again.",
  "not-yours-to-answer": "Only the person the bot asked, or the owner, can answer this.",
  persistence: "Could not save the change.",
} as const;

export const RoomsErrorReason = Schema.Literals(
  Object.keys(ROOMS_ERROR_MESSAGES) as Array<keyof typeof ROOMS_ERROR_MESSAGES>,
);
export type RoomsErrorReason = typeof RoomsErrorReason.Type;

export class RoomsError extends Schema.TaggedError<RoomsError>()("RoomsError", {
  reason: RoomsErrorReason,
  cause: Schema.optionalKey(Schema.Defect()),
}) {
  override get message(): string {
    return ROOMS_ERROR_MESSAGES[this.reason];
  }
}

const isNameChar = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}_-]/u.test(char);

// Offsets must line up with the original text, and a few characters (`İ`) lengthen when lowered.
const foldCase = (text: string) => {
  const lower = text.toLowerCase();
  if (lower.length === text.length) return lower;
  return Array.from(text, (char) => {
    const folded = char.toLowerCase();
    return folded.length === char.length ? folded : char;
  }).join("");
};

/** Indices of `names`, longest name first, so `@Chef Bot` claims its text before `@Chef`. */
const longestFirst = (names: ReadonlyArray<string>) =>
  names
    .map((name, index) => ({ name, index }))
    .filter((entry) => entry.name.trim() !== "")
    .sort((a, b) => b.name.length - a.name.length);

export interface RoomMentionSpan {
  readonly start: number;
  readonly end: number;
  /** Which of the given names. */
  readonly index: number;
}

/**
 * Every `@Name` in a message that sets a bot off: ignoring case, not inside a longer word, longer
 * names first so `@Chef Bot` is not also `@Chef`. Sorted by position.
 */
export function roomMentionSpans(
  text: string,
  names: ReadonlyArray<string>,
): ReadonlyArray<RoomMentionSpan> {
  if (names.length === 0 || !text.includes("@")) return [];
  const lower = foldCase(text);
  const claimed = new Array<boolean>(lower.length).fill(false);
  const spans: Array<RoomMentionSpan> = [];
  for (const { name, index } of longestFirst(names)) {
    const needle = `@${foldCase(name)}`;
    for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, at + 1)) {
      const end = at + needle.length;
      if (claimed[at] || isNameChar(lower[at - 1]) || isNameChar(lower[end])) continue;
      claimed.fill(true, at, end);
      spans.push({ start: at, end, index });
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

export interface RoomMentionSegment {
  readonly start: number;
  readonly text: string;
  /** The bot's name, when this piece is a mention of it. */
  readonly mention?: string;
}

/** A message cut into plain text and `@Name` mentions, in order, for drawing them apart. */
export function roomMentionSegments(
  text: string,
  names: ReadonlyArray<string>,
): ReadonlyArray<RoomMentionSegment> {
  const segments: Array<RoomMentionSegment> = [];
  let cursor = 0;
  for (const span of roomMentionSpans(text, names)) {
    if (span.start > cursor) {
      segments.push({ start: cursor, text: text.slice(cursor, span.start) });
    }
    segments.push({
      start: span.start,
      text: text.slice(span.start, span.end),
      mention: names[span.index]!,
    });
    cursor = span.end;
  }
  if (cursor < text.length || segments.length === 0) {
    segments.push({ start: cursor, text: text.slice(cursor) });
  }
  return segments;
}

/** The bots a message addresses, by `roomMentionSpans`, longest name first. */
export function mentionedBots(
  text: string,
  bots: ReadonlyArray<{ readonly projectId: ProjectId; readonly name: string }>,
): ReadonlyArray<ProjectId> {
  const names = bots.map((bot) => bot.name);
  const mentioned = new Set(roomMentionSpans(text, names).map((span) => span.index));
  const found: Array<ProjectId> = [];
  for (const { index } of longestFirst(names)) {
    const projectId = bots[index]!.projectId;
    if (mentioned.has(index) && !found.includes(projectId)) found.push(projectId);
  }
  return found;
}

/** "Scout, Chef and Anna": what an unnamed chat is called, as phones name group threads. */
export function defaultRoomTitle(names: ReadonlyArray<string>): string {
  if (names.length <= 1) return names[0] ?? "Group chat";
  if (names.length <= 3) return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} others`;
}
