import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

import { ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";
import { isListedThreadLineage, type OrchestrationV2AppThreadLineage } from "./orchestrationV2.ts";
import { ProjectAvatar } from "./project.ts";

export const BotCreateInput = Schema.Struct({
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  modelSelection: ModelSelection,
  /** The look picked while hatching; absent lets the server step away from sibling bots' looks. */
  avatar: Schema.optional(ProjectAvatar),
  /** Start the main thread's first turn so the bot opens its hatching interview. Defaults on. */
  hatch: Schema.optional(Schema.Boolean),
});
export type BotCreateInput = typeof BotCreateInput.Type;

export const BotCreateResult = Schema.Struct({
  projectId: ProjectId,
  mainThreadId: ThreadId,
});
export type BotCreateResult = typeof BotCreateResult.Type;

/** How a bot another bot creates starts: interviewing the user, or setting itself up from a brief. */
export const BotChildStart = Schema.Literals(["interview", "brief"]);
export type BotChildStart = typeof BotChildStart.Type;

const ChildBotProject = ProjectId.annotate({ description: "The child's projectId." });
const BotMessageText = TrimmedNonEmptyString.check(Schema.isMaxLength(20_000));

export const BotMcpCreateChildInput = Schema.Struct({
  name: BotCreateInput.fields.name,
  mode: BotChildStart.annotate({
    description: "interview: it asks the user who to be. brief: it sets itself up from `brief`.",
  }),
  brief: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(8_000)).annotate({
      description: "For brief: who it is, its job, what to do on its own.",
    }),
  ),
});
export type BotMcpCreateChildInput = typeof BotMcpCreateChildInput.Type;

/** What another bot is to the one asking: its parent, a bot it created, a sibling, or neither. */
export const BotRelation = Schema.Literals(["parent", "child", "sibling", "other"]);
export type BotRelation = typeof BotRelation.Type;

export const BotMcpReachableBot = Schema.Struct({
  projectId: ProjectId,
  name: Schema.String,
  relation: BotRelation,
  archived: Schema.Boolean,
});
export type BotMcpReachableBot = typeof BotMcpReachableBot.Type;

export const BotMcpListBotsResult = Schema.Struct({ bots: Schema.Array(BotMcpReachableBot) });
export type BotMcpListBotsResult = typeof BotMcpListBotsResult.Type;

export const BotMcpReadChildInput = Schema.Struct({
  projectId: ChildBotProject,
  limit: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 })).annotate({
      description: "Latest messages to return, 1-50. Default 20.",
    }),
  ),
});
export type BotMcpReadChildInput = typeof BotMcpReadChildInput.Type;

/** Who wrote a message in a child's conversation, as its parent sees it. */
export const BotFamilyAuthor = Schema.Literals(["user", "you", "child", "routine", "system"]);
export type BotFamilyAuthor = typeof BotFamilyAuthor.Type;

export const BotMcpReadChildResult = Schema.Struct({
  messages: Schema.Array(
    Schema.Struct({ author: BotFamilyAuthor, text: Schema.String, createdAt: Schema.String }),
  ),
});
export type BotMcpReadChildResult = typeof BotMcpReadChildResult.Type;

export const BotMcpMessageChildInput = Schema.Struct({
  projectId: ChildBotProject,
  message: BotMessageText,
});
export type BotMcpMessageChildInput = typeof BotMcpMessageChildInput.Type;

export const BotMcpMessageBotInput = Schema.Struct({
  projectId: ProjectId.annotate({ description: "The bot's projectId, from list_bots." }),
  message: BotMessageText,
});
export type BotMcpMessageBotInput = typeof BotMcpMessageBotInput.Type;

export const BotMcpReportToParentInput = Schema.Struct({ message: BotMessageText });
export type BotMcpReportToParentInput = typeof BotMcpReportToParentInput.Type;

export const BotMcpTellMainConversationInput = Schema.Struct({ text: BotMessageText });
export type BotMcpTellMainConversationInput = typeof BotMcpTellMainConversationInput.Type;

export const BotMcpListGroupChatsResult = Schema.Struct({
  groupChats: Schema.Array(
    Schema.Struct({
      roomId: TrimmedNonEmptyString,
      title: Schema.String,
      people: Schema.Array(Schema.String),
      bots: Schema.Array(Schema.String),
    }),
  ),
});
export type BotMcpListGroupChatsResult = typeof BotMcpListGroupChatsResult.Type;

export const BotMcpPostToGroupChatInput = Schema.Struct({
  roomId: TrimmedNonEmptyString,
  text: BotMessageText,
});
export type BotMcpPostToGroupChatInput = typeof BotMcpPostToGroupChatInput.Type;

export const BotMcpDelivery = Schema.Struct({
  delivery: Schema.Literals(["started", "queued", "steered", "restarted"]),
});
export type BotMcpDelivery = typeof BotMcpDelivery.Type;

/** `ended: false` when no call with this conversation was live. */
export const BotMcpEndCallResult = Schema.Struct({ ended: Schema.Boolean });
export type BotMcpEndCallResult = typeof BotMcpEndCallResult.Type;

export const BotArchiveInput = Schema.Struct({
  projectId: ProjectId,
  /** Also archive the bots this bot created. */
  includeChildren: Schema.optional(Schema.Boolean),
});
export type BotArchiveInput = typeof BotArchiveInput.Type;

export const BotArchiveResult = Schema.Struct({
  /** Every bot archived, the requested one first. */
  projectIds: Schema.Array(ProjectId),
});
export type BotArchiveResult = typeof BotArchiveResult.Type;

export const BotUnarchiveInput = Schema.Struct({ projectId: ProjectId });
export type BotUnarchiveInput = typeof BotUnarchiveInput.Type;

export const BotDeleteInput = Schema.Struct({
  projectId: ProjectId,
  /** Also delete the bot's home folder from disk. Off unless asked. */
  removeHomeFolder: Schema.optional(Schema.Boolean),
});
export type BotDeleteInput = typeof BotDeleteInput.Type;

/** A microphone close to the mouth (phone, headset) or across the room (laptop). */
export const BotCallNoiseReduction = Schema.Literals(["near_field", "far_field"]);
export type BotCallNoiseReduction = typeof BotCallNoiseReduction.Type;

export const BotCallStartInput = Schema.Struct({
  projectId: ProjectId,
  /** The bot conversation the call joins: requests land there, and so does the call's recap. */
  threadId: ThreadId,
  /** The client's WebRTC offer. Audio flows between the client and OpenAI, never through the server. */
  sdpOffer: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100_000)),
  noiseReduction: Schema.optional(BotCallNoiseReduction),
});
export type BotCallStartInput = typeof BotCallStartInput.Type;

export const BotCallStartResult = Schema.Struct({
  callId: TrimmedNonEmptyString,
  sdpAnswer: Schema.String,
});
export type BotCallStartResult = typeof BotCallStartResult.Type;

export const BotCallEndInput = Schema.Struct({
  callId: TrimmedNonEmptyString,
});
export type BotCallEndInput = typeof BotCallEndInput.Type;

export class BotCallError extends Schema.TaggedError<BotCallError>()("BotCallError", {
  /** `not-configured`: no OpenAI API key. `rejected`: OpenAI refused the call. */
  reason: Schema.Literals(["not-configured", "not-found", "rejected", "unavailable"]),
  message: TrimmedNonEmptyString,
}) {}

/** The background thread a bot's Heartbeat routine runs in, out of its conversations. */
export const botHeartbeatThreadId = (projectId: ProjectId) =>
  ThreadId.make(`heartbeat:${projectId}`);

/** The background thread one routine runs in, so its runs stay out of the bot's conversations. */
export const botRoutineThreadId = (taskId: string) => ThreadId.make(`routine:${taskId}`);

/** The hidden thread a bot answers one room in; see `docs/adr/0003-rooms-front-per-bot-threads.md`. */
export const botRoomThreadId = (roomId: string, projectId: ProjectId) =>
  ThreadId.make(`room:${roomId}:${projectId}`);

export const isRoomThreadId = (threadId: ThreadId) => threadId.startsWith("room:");

/**
 * A thread the user talks to the bot in: its main one, or one started beside it. Helpers, side
 * chats, routine threads and the Heartbeat thread are the bot's background work, which Activity
 * lists.
 */
export function isBotConversationThread(
  thread: {
    readonly id: ThreadId;
    readonly projectId: ProjectId;
    readonly lineage: OrchestrationV2AppThreadLineage;
  },
  mainThreadId: ThreadId | null,
): boolean {
  return (
    thread.id === mainThreadId ||
    (isListedThreadLineage(thread.lineage) &&
      thread.id !== botHeartbeatThreadId(thread.projectId) &&
      !thread.id.startsWith("routine:") &&
      !isRoomThreadId(thread.id))
  );
}

type Timestamp = string | DateTime.DateTime;

const epochMillis = (at: Timestamp) =>
  typeof at === "string" ? Date.parse(at) : DateTime.toEpochMillis(at);

/**
 * A bot's conversation: the recorded main thread, else its project's oldest unarchived thread.
 * Accepts server thread shells and client ones, whose timestamps are ISO strings.
 */
export function botMainThreadId(
  project: { readonly id: ProjectId; readonly mainThreadId?: ThreadId | null | undefined },
  threads: ReadonlyArray<{
    readonly id: ThreadId;
    readonly projectId: ProjectId;
    readonly createdAt: Timestamp;
    readonly archivedAt: Timestamp | null;
  }>,
): ThreadId | null {
  if (project.mainThreadId) return project.mainThreadId;
  let earliest: { readonly id: ThreadId; readonly createdAt: number } | undefined;
  for (const thread of threads) {
    if (thread.projectId !== project.id || thread.archivedAt !== null) continue;
    const createdAt = epochMillis(thread.createdAt);
    if (
      earliest === undefined ||
      createdAt < earliest.createdAt ||
      (createdAt === earliest.createdAt && thread.id < earliest.id)
    ) {
      earliest = { id: thread.id, createdAt };
    }
  }
  return earliest?.id ?? null;
}
