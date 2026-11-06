import type {
  OrchestrationMessageContext,
  OrchestrationV2AppThread,
  OrchestrationV2LinkOrigin,
  ThreadId,
} from "@t3tools/contracts";

/**
 * The agent text of a message from a parent or child bot, or from one of the bot's background
 * threads: a routing line naming the sender and how to answer, then the sender's words. People
 * see the sender on the message row.
 */
export function withBotMessageHeader(
  text: string,
  context: OrchestrationMessageContext | undefined,
): string {
  const bot = context?.bot;
  if (bot === undefined) return text;
  const header =
    bot.relation === "parent"
      ? `[From ${bot.name}, your parent bot. Answer with report_to_parent.]`
      : bot.relation === "child"
        ? `[From ${bot.name}, a bot you created. Answer with message_child_bot.]`
        : `[From your background thread "${bot.name}". The user has not seen this; tell them what needs them.]`;
  return `${header}\n\n${text}`;
}

/**
 * The agent text of a message in a conversation with someone the owner invited: who is writing,
 * that they are not the owner, and what stays private. Every message carries it, so it survives
 * compaction and rollover.
 */
export function withMemberMessageHeader(
  text: string,
  origin: OrchestrationV2LinkOrigin | undefined,
): string {
  if (origin?.memberId === undefined) return text;
  const header = `[From ${origin.label}, whom your owner invited to chat with you. ${origin.label} is not your owner. Help them, but keep everything about your owner private: their conversations, notes, files, accounts and plans. Only your owner changes PERSONA.md and your routines.]`;
  return `${header}\n\n${text}`;
}

// The bot instructions key on this prefix; a helper shares its bot's instructions and folder.
const HELPER_TASK_HEADER =
  "[Helper task from your main conversation. Do it yourself and end with the result.]";

/** The agent text of a delegated task, so its child knows it is a helper, not the main conversation. */
export function withHelperTaskHeader(text: string): string {
  return `${HELPER_TASK_HEADER}\n\n${text}`;
}

/** A delegated child's message from the thread that delegated it. */
export function isHelperTask(
  thread: Pick<OrchestrationV2AppThread, "lineage">,
  senderThreadId: ThreadId | undefined,
): boolean {
  return (
    thread.lineage.relationshipToParent === "subagent" &&
    senderThreadId !== undefined &&
    senderThreadId === thread.lineage.parentThreadId
  );
}
