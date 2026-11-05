import {
  OrchestratorMcpFailure,
  type OrchestratorMcpRequestUserActionInput,
  type OrchestratorMcpRequestUserActionResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { McpSchema } from "effect/ai";

import type { BotChildApproval } from "../bots/Bots.ts";

/** The approval card shows this text over its Approve and Decline buttons. */
const cardMessage = (input: OrchestratorMcpRequestUserActionInput): string =>
  [input.title, input.reason, input.url, "Approve once it's done, or Decline."]
    .filter((part) => part !== undefined)
    .join("\n\n");

const childBotCardMessage = (approval: BotChildApproval): string =>
  [
    `${approval.parentName} wants to create a new bot, ${approval.childName}.`,
    approval.brief === undefined
      ? "It will interview you about who to be."
      : `It will set itself up from this brief:\n\n${approval.brief}`,
    `Approve to create it, or Decline. To skip this card, turn on "Can create bots without asking" in ${approval.parentName}'s settings.`,
  ].join("\n\n");

const unavailable = (message: string) =>
  new OrchestratorMcpFailure({ code: "provider_unavailable", message });

/**
 * Asks through an MCP elicitation, which harnesses that support one show as T3's approval card,
 * so the request needs no orchestration state of its own. True when the user approves.
 */
const askWithCard = Effect.fn("McpUserActionRequest.ask")(function* (message: string) {
  // Request-scoped: McpHttpServer provides it to sessioned calls only, so it stays optional here.
  const session = Option.getOrUndefined(yield* Effect.serviceOption(McpSchema.McpServerClient));
  if (session?.clientCapabilities.elicitation === undefined) {
    return yield* unavailable(
      "This agent's harness cannot show an action card. Ask the user in chat instead.",
    );
  }
  const client = yield* session.getClient;
  const result = yield* client
    .elicit(
      new McpSchema.ElicitRequestFormParams({
        mode: "form",
        message,
        requestedSchema: { type: "object", properties: {} },
      }),
    )
    .pipe(
      Effect.catchTags({
        McpReverseOperationError: (error) => unavailable(`The card failed: ${error.message}`),
        McpReverseOperationUnsupported: () =>
          unavailable("This agent's harness cannot show an action card. Ask the user in chat."),
      }),
    );
  if (result.action === "cancel") return yield* Effect.interrupt;
  return result.action === "accept";
}, Effect.scoped);

export const requestUserAction = Effect.fn("McpUserActionRequest.request")(function* (
  input: OrchestratorMcpRequestUserActionInput,
) {
  const approved = yield* askWithCard(cardMessage(input));
  return {
    status: approved ? "done" : "declined",
  } satisfies OrchestratorMcpRequestUserActionResult;
});

/** The card a parent bot's turn shows before it creates a child, unless it may skip asking. */
export const approveChildBot = (approval: BotChildApproval) =>
  askWithCard(childBotCardMessage(approval));

const archiveCardMessage = (input: {
  readonly name: string;
  readonly reason: string;
  readonly includeChildren: boolean;
}) =>
  [
    `Archive ${input.name}${input.includeChildren ? " and the bots it created" : ""}?`,
    input.reason,
    "Archiving pauses its routines and hides it from your bots. Its conversation and home folder stay, and you can unarchive it from Settings.",
    "Approve to archive, or Decline.",
  ].join("\n\n");

/** The card a bot's suggestion to archive itself, or a bot it created, shows. True to archive. */
export const approveBotArchive = (input: Parameters<typeof archiveCardMessage>[0]) =>
  askWithCard(archiveCardMessage(input));
