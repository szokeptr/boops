import type { OrchestrationMessageContext } from "@t3tools/contracts";

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
