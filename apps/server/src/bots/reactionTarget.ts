import type { OrchestrationV2ConversationMessage } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

/**
 * The newest message the user or another bot wrote, which `react_to_message` reacts to. Records
 * come in turn-item order, not time order, so this compares `createdAt`. Wakes, routine prompts,
 * delegated-task results and the bot's own background notes are not written by anyone.
 */
export function latestReactableMessage(
  messages: ReadonlyArray<OrchestrationV2ConversationMessage>,
): OrchestrationV2ConversationMessage | undefined {
  let latest: OrchestrationV2ConversationMessage | undefined;
  for (const message of messages) {
    if (
      message.role !== "user" ||
      message.streaming ||
      message.createdBy === "system" ||
      message.notification !== undefined ||
      message.routine !== undefined ||
      message.delegatedCompletion !== undefined ||
      message.context?.bot?.relation === "background"
    ) {
      continue;
    }
    if (latest === undefined || DateTime.isGreaterThan(message.createdAt, latest.createdAt)) {
      latest = message;
    }
  }
  return latest;
}
