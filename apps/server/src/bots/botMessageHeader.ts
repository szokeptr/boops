import type {
  OrchestrationMessageContext,
  OrchestrationV2AppThread,
  ThreadId,
} from "@t3tools/contracts";

/**
 * The agent text of a message from a parent or child bot: a routing line naming the sender and
 * the tool that answers it, then the sender's words. People see the sender on the message row.
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
      : `[From ${bot.name}, a bot you created. Answer with message_child_bot.]`;
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
