import {
  OrchestratorMcpFailure,
  type OrchestratorMcpRequestUserActionInput,
  type OrchestratorMcpRequestUserActionResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { McpSchema } from "effect/ai";

/** The approval card shows this text over its Approve and Decline buttons. */
const cardMessage = (input: OrchestratorMcpRequestUserActionInput): string =>
  [input.title, input.reason, input.url, "Approve once it's done, or Decline."]
    .filter((part) => part !== undefined)
    .join("\n\n");

const unavailable = (message: string) =>
  new OrchestratorMcpFailure({ code: "provider_unavailable", message });

/**
 * Asks through an MCP elicitation, which harnesses that support one show as T3's approval card,
 * so the request needs no orchestration state of its own.
 */
export const requestUserAction = Effect.fn("McpUserActionRequest.request")(function* (
  input: OrchestratorMcpRequestUserActionInput,
) {
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
        message: cardMessage(input),
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
  return {
    status: result.action === "accept" ? "done" : "declined",
  } satisfies OrchestratorMcpRequestUserActionResult;
}, Effect.scoped);
