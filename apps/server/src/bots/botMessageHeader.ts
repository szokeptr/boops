import type {
  OrchestrationMessageContext,
  OrchestrationV2AppThread,
  OrchestrationV2LinkOrigin,
  ThreadId,
} from "@t3tools/contracts";

/**
 * The agent text of a message from another bot, one of the bot's background threads, or
 * a voice call: a routing line naming the sender and how to answer, then the sender's words. People
 * see the sender on the message row.
 */
export function withBotMessageHeader(
  text: string,
  context: OrchestrationMessageContext | undefined,
): string {
  const call = context?.call;
  if (call !== undefined) {
    const header =
      call.kind === "request"
        ? "[Said on a voice call. Your voice passed it on and reads your reply to the user, so answer in a few plain spoken sentences, without markdown, tables or links unless they asked for one. If they are saying goodbye or want the call ended, call end_call.]"
        : "[The user's voice call with you just ended; your voice spoke for you. Its transcript is below, and requests from it already reached you as their own messages. Save anything durable to memory/, then reply in one short line.]";
    return `${header}\n\n${text}`;
  }
  const bot = context?.bot;
  if (bot === undefined) return text;
  const header =
    bot.relation === "parent"
      ? `[From ${bot.name}, your parent bot. Answer with report_to_parent.]`
      : bot.relation === "child"
        ? `[From ${bot.name}, a bot you created. Answer with message_child_bot.]`
        : bot.relation === "peer"
          ? `[From ${bot.name}, another bot. Answer with message_bot, projectId ${bot.projectId}.]`
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
  const header = `[From ${origin.label}, whom your owner invited to chat with you. ${origin.label} is not your owner. Help them as you would your owner: your notes, files and every Connection you can use here are shared with ${origin.label}. Only your conversations with your owner stay private, so don't repeat what was said in them. Only your owner changes PERSONA.md and your routines.]`;
  return `${header}\n\n${text}`;
}

const REACTION_EXCERPT_CHARS = 80;

/**
 * The agent text of the user's next message after they reacted to the agent's messages, as a
 * tapback: which emoji, on which message. A reaction alone never starts a turn.
 */
export function withReactionsHeader(
  text: string,
  reactions: ReadonlyArray<{ readonly emoji: string; readonly text: string }>,
): string {
  if (reactions.length === 0) return text;
  const excerpts = reactions.map(({ emoji, text: reacted }) => {
    const line = reacted.replaceAll(/\s+/g, " ").trim();
    const excerpt =
      line.length > REACTION_EXCERPT_CHARS ? `${line.slice(0, REACTION_EXCERPT_CHARS)}…` : line;
    return `${emoji} to "${excerpt}"`;
  });
  return `[Since your last turn, the user reacted ${excerpts.join(", ")}.]\n\n${text}`;
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
