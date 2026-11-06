import {
  type BotMessageOrigin,
  type ChatAttachment,
  type ChatFileAttachment,
  type GuestMessageAttribution,
  type OrchestrationMessageContext,
  type OrchestrationV2Actor,
  type OrchestrationV2CreationSource,
  type OrchestrationV2IdleCompaction,
  type OrchestrationV2RoutineLabel,
  type OrchestrationV2RoutineTrigger,
  type OrchestrationV2UserMessageInputIntent,
} from "@t3tools/contracts";
import {
  isAttachmentOnlyBootstrapPrompt,
  replaceComposerContextReferences,
} from "@t3tools/shared/composerContextReferences";
import { filePreviewKind } from "@t3tools/shared/filePreview";
import { imageMimeType } from "@t3tools/shared/image";
import { videoMimeType } from "@t3tools/shared/video";

/** The working row while T3 Code's own compaction runs. */
export const IDLE_COMPACTING_LABELS = {
  beforeCacheExpires: "Compacting before the cache expires…",
  onReturn: "Compacting…",
} satisfies Record<OrchestrationV2IdleCompaction, string>;

/** Leads the finished compaction's token counts, in place of "Context compacted". */
export const IDLE_COMPACTION_TITLES = {
  beforeCacheExpires: "Context automatically compacted before cache expiry",
  onReturn: "Context compacted before sending",
} satisfies Record<OrchestrationV2IdleCompaction, string>;

const LEGACY_AUTOMATION_PREFIX = /^\[Triggered by schedule task: [^\r\n]+\]\r?\n\r?\n/;
// Bot-to-bot messages sent before `context.bot` carried the routing line in their text.
const LEGACY_BOT_MESSAGE_PREFIX =
  /^\[From ([^\r\n]+?), (?:your parent bot\. Answer with report_to_parent|a bot you created\. Answer with message_child_bot)\.\]\r?\n\r?\n/;
const LEGACY_AUTOMATION_MESSAGE_ID = /^scheduled-task-message:(.+):\d+:(?:scheduled|manual)$/;

const ROUTINE_TRIGGER_LABELS = {
  interval: "Repeating",
  fixed_time: "Scheduled time",
  once: "One time",
  webhook: "Webhook",
  manual: "Run now",
} satisfies Record<OrchestrationV2RoutineTrigger, string>;

/** The row label for a routine message: its name and what fired it. */
export function routineLabelText(routine: OrchestrationV2RoutineLabel): string {
  return `${routine.name} · ${ROUTINE_TRIGGER_LABELS[routine.trigger]}`;
}

export function resolveUserMessageFileCards(message: {
  readonly text: string;
  readonly attachments: ReadonlyArray<ChatAttachment>;
  readonly context?: OrchestrationMessageContext | undefined;
}): ReadonlyArray<ChatFileAttachment> | null {
  const files = message.attachments.filter(
    (attachment): attachment is ChatFileAttachment =>
      attachment.type === "file" &&
      imageMimeType(attachment) === null &&
      videoMimeType(attachment) === null &&
      filePreviewKind(attachment) !== "audio",
  );
  if (files.length === 0 || files.length !== message.attachments.length) return null;
  const fileIds = new Set(files.map((file) => file.id));
  const remaining = replaceComposerContextReferences(message.text, (reference) => {
    const record = message.context?.records.find((item) => item.contextId === reference.contextId);
    return reference.kind === "file" &&
      record?.kind === "file" &&
      "attachmentId" in record &&
      fileIds.has(record.attachmentId)
      ? ""
      : reference.label || reference.kind;
  });
  return remaining.trim() === "" ? files : null;
}

export function resolveUserMessagePresentation(message: {
  readonly id?: string;
  readonly role: string;
  readonly text: string;
  readonly createdBy?: OrchestrationV2Actor;
  readonly creationSource?: OrchestrationV2CreationSource;
  readonly routine?: OrchestrationV2RoutineLabel | undefined;
  readonly context?:
    | {
        readonly guest?: GuestMessageAttribution | undefined;
        readonly bot?: BotMessageOrigin | undefined;
      }
    | undefined;
}): {
  readonly text: string;
  /** "system" is a server event such as a bot's hatching kickoff; it renders as a divider. */
  readonly attribution: "automation" | "agent" | "t3code" | "guest" | "bot" | "system" | null;
  readonly routine: OrchestrationV2RoutineLabel | undefined;
  /** Set when `attribution` is "guest". */
  readonly guestName?: string;
  /** Set when `attribution` is "bot". Messages from before the typed origin have no project. */
  readonly bot?: {
    /** The sender line; for the bot's own background thread, "From <thread title>". */
    readonly name: string;
    readonly projectId: BotMessageOrigin["projectId"] | null;
    /** Sent by one of the receiving bot's own background threads, such as its heartbeat. */
    readonly background: boolean;
  };
} {
  if (message.role !== "user") {
    return { text: message.text, attribution: null, routine: undefined };
  }
  // The stored text names the guest for the agent; people see the guest's own words.
  const guest = message.context?.guest;
  if (guest !== undefined) {
    return {
      text: guest.text,
      attribution: "guest",
      routine: undefined,
      guestName: guest.name,
    };
  }
  // The agent reads a routing line the server adds; people see the sender's words.
  const bot = message.context?.bot;
  if (bot !== undefined) {
    return {
      text: message.text,
      attribution: "bot",
      routine: undefined,
      bot:
        bot.relation === "background"
          ? { name: `From ${bot.name}`, projectId: bot.projectId, background: true }
          : { name: bot.name, projectId: bot.projectId, background: false },
    };
  }
  const legacyBot =
    message.createdBy === "agent" ? LEGACY_BOT_MESSAGE_PREFIX.exec(message.text) : null;
  if (legacyBot !== null) {
    return {
      text: message.text.slice(legacyBot[0].length),
      attribution: "bot",
      routine: undefined,
      bot: { name: legacyBot[1]!, projectId: null, background: false },
    };
  }
  if (message.routine !== undefined) {
    return { text: message.text, attribution: "automation", routine: message.routine };
  }
  const legacyPrefix = LEGACY_AUTOMATION_PREFIX.exec(message.text);
  if (
    legacyPrefix !== null &&
    (LEGACY_AUTOMATION_MESSAGE_ID.test(message.id ?? "") || message.createdBy === "agent")
  ) {
    return {
      text: message.text.slice(legacyPrefix[0].length),
      attribution: "automation",
      routine: undefined,
    };
  }
  return {
    // The agent needs words to start a turn; people sent only the attachments.
    text: isAttachmentOnlyBootstrapPrompt(message.text) ? "" : message.text,
    attribution:
      message.createdBy === "system"
        ? "system"
        : message.createdBy !== "agent"
          ? null
          : message.creationSource === "server"
            ? "t3code"
            : "agent",
    routine: undefined,
  };
}

/**
 * A routine that ran and had nothing to say leaves no trace in a bot's chat. Its wake stays while
 * something from the run (a reply, a card, the typing row) follows it.
 */
export function withoutSilentRoutineWakes<Row>(
  rows: ReadonlyArray<Row>,
  userMessageOf: (row: Row) => Parameters<typeof resolveUserMessagePresentation>[0] | null,
): Row[] {
  return rows.filter((row, index) => {
    const message = userMessageOf(row);
    if (message === null || resolveUserMessagePresentation(message).attribution !== "automation") {
      return true;
    }
    const next = rows[index + 1];
    return next !== undefined && userMessageOf(next) === null;
  });
}

type GroupableUserMessage = Parameters<typeof resolveUserMessagePresentation>[0] & {
  readonly inputIntent?: OrchestrationV2UserMessageInputIntent;
};

export function resolveUserMessageGrouping(
  message: GroupableUserMessage | undefined,
  previous: GroupableUserMessage | undefined,
  next: GroupableUserMessage | undefined,
) {
  const isOwnMessage = (value: GroupableUserMessage | undefined) =>
    value?.role === "user" && resolveUserMessagePresentation(value).attribution === null;
  const isSteer = (value: GroupableUserMessage | undefined) =>
    value?.inputIntent === "steer" || value?.inputIntent === "promoted_queued_to_steer";
  const groupedWithPrevious = isOwnMessage(message) && isOwnMessage(previous);
  return {
    groupedWithPrevious,
    groupedWithNext: isOwnMessage(message) && isOwnMessage(next),
    continuesSteer: groupedWithPrevious && isSteer(message) && isSteer(previous),
  };
}
