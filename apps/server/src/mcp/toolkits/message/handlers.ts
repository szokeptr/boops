import { isRoomThreadId, OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as McpToolAccess from "../../McpToolAccess.ts";
import { loadCaller } from "../../threadAccess.ts";
import { MessageToolkit } from "./tools.ts";

const handlers = {
  send_to_user: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const { caller } = yield* loadCaller();
      // A group chat posts only the turn's reply, so a message sent here would never reach it.
      if (
        caller !== undefined &&
        (isRoomThreadId(caller.id) || isRoomThreadId(caller.lineage.rootThreadId))
      ) {
        return yield* new OrchestratorMcpFailure({
          code: "capability_denied",
          message: "In a group chat, put this in your reply instead; only your reply is posted.",
        });
      }
      return {
        sentMessage: input.message,
        message: "Shown to the user. Don't repeat it.",
      };
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof MessageToolkit.tools>;

export const layer = McpToolAccess.toLayer(MessageToolkit, handlers);
