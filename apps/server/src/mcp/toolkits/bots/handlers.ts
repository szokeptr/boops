import { OrchestratorMcpFailure, RoomId, type RoomsError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as BotCalls from "../../../bots/BotCalls.ts";
import type { BotFamilyError } from "../../../bots/botFamily.ts";
import * as Bots from "../../../bots/Bots.ts";
import * as Rooms from "../../../rooms/Rooms.ts";
import { assertNotLinked } from "../../linkOrigin.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { loadCaller } from "../../threadAccess.ts";
import { approveChildBot } from "../../userActionRequest.ts";
import { BotToolkit } from "./tools.ts";

const DEFAULT_READ_LIMIT = 20;

/** The calling thread. Bots reach only bots on their own machine. */
const callerThread = Effect.gen(function* () {
  const caller = yield* loadCaller();
  yield* assertNotLinked(caller, "reach bots on this machine");
  if (caller.caller === undefined) {
    return yield* new OrchestratorMcpFailure({
      code: "thread_credential_required",
      message: "Only a bot's own thread can use this tool.",
    });
  }
  return caller.caller;
});

/** The calling thread's bot. */
const callerBot = Effect.map(callerThread, (thread) => thread.projectId);

const toFailure = (error: BotFamilyError | Bots.BotHomeFolderError | Bots.BotCreateError) =>
  new OrchestratorMcpFailure({
    code:
      error._tag !== "BotFamilyError"
        ? "orchestration_error"
        : error.reason === "unrelated"
          ? "capability_denied"
          : error.reason === "not-found"
            ? "target_required"
            : error.reason === "unavailable"
              ? "orchestration_error"
              : "invalid_request",
    message: error.message,
  });

const mapBotErrors = <A, R>(
  effect: Effect.Effect<
    A,
    OrchestratorMcpFailure | BotFamilyError | Bots.BotHomeFolderError | Bots.BotCreateError,
    R
  >,
) =>
  effect.pipe(
    Effect.mapError((error) =>
      error._tag === "OrchestratorMcpFailure" ? error : toFailure(error),
    ),
  );

const roomFailure = (error: RoomsError) =>
  new OrchestratorMcpFailure({
    code: error.reason === "not-found" ? "target_required" : "orchestration_error",
    message:
      error.reason === "not-found"
        ? "You are not in that group chat. Call list_group_chats for the ones you are in."
        : error.message,
  });

const handlers = {
  create_child_bot: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const parentProjectId = yield* callerBot;
      const bots = yield* Bots.Bots;
      return yield* bots.createChild(
        {
          parentProjectId,
          name: input.name,
          mode: input.mode,
          ...(input.brief === undefined ? {} : { brief: input.brief }),
        },
        approveChildBot,
      );
    }).pipe(mapBotErrors),
  ),
  list_bots: McpToolAccess.readsAsCaller(() =>
    Effect.gen(function* () {
      const projectId = yield* callerBot;
      const bots = yield* Bots.Bots;
      const reachable = yield* bots.reachableFrom(projectId);
      return {
        bots: reachable.map(({ bot, relation }) => ({
          projectId: bot.id,
          name: bot.title,
          relation,
          archived: bot.archivedAt != null,
        })),
      };
    }).pipe(mapBotErrors),
  ),
  read_child_bot: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const parentProjectId = yield* callerBot;
      const bots = yield* Bots.Bots;
      const messages = yield* bots.readChild({
        parentProjectId,
        childProjectId: input.projectId,
        limit: input.limit ?? DEFAULT_READ_LIMIT,
      });
      return { messages };
    }).pipe(mapBotErrors),
  ),
  message_child_bot: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const parentProjectId = yield* callerBot;
      const bots = yield* Bots.Bots;
      return yield* bots.messageChild({
        parentProjectId,
        childProjectId: input.projectId,
        text: input.message,
      });
    }).pipe(mapBotErrors),
  ),
  message_bot: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const fromProjectId = yield* callerBot;
      const bots = yield* Bots.Bots;
      return yield* bots.messageBot({
        fromProjectId,
        toProjectId: input.projectId,
        text: input.message,
      });
    }).pipe(mapBotErrors),
  ),
  report_to_parent: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const childProjectId = yield* callerBot;
      const bots = yield* Bots.Bots;
      return yield* bots.reportToParent({ childProjectId, text: input.message });
    }).pipe(mapBotErrors),
  ),
  tell_main_conversation: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const thread = yield* callerThread;
      const bots = yield* Bots.Bots;
      return yield* bots.tellMainConversation({
        projectId: thread.projectId,
        fromThreadId: thread.id,
        text: input.text,
      });
    }).pipe(mapBotErrors),
  ),
  react_to_message: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const thread = yield* callerThread;
      const bots = yield* Bots.Bots;
      return yield* bots.reactToLatestMessage({
        projectId: thread.projectId,
        threadId: thread.id,
        emoji: input.emoji ?? null,
      });
    }).pipe(mapBotErrors),
  ),
  end_call: McpToolAccess.actsAsCaller(() =>
    Effect.gen(function* () {
      const thread = yield* callerThread;
      const calls = yield* BotCalls.BotCalls;
      return { ended: yield* calls.endForThread(thread.id) };
    }),
  ),
  list_group_chats: McpToolAccess.readsAsCaller(() =>
    Effect.gen(function* () {
      const projectId = yield* callerBot;
      const rooms = yield* Rooms.Rooms;
      const groupChats = yield* rooms.roomsOfBot(projectId).pipe(Effect.mapError(roomFailure));
      return { groupChats };
    }),
  ),
  post_to_group_chat: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const from = yield* callerThread;
      const rooms = yield* Rooms.Rooms;
      yield* rooms
        .postAsBot({ from, roomId: RoomId.make(input.roomId), text: input.text })
        .pipe(Effect.mapError(roomFailure));
      return { posted: true };
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof BotToolkit.tools>;

export const layer = McpToolAccess.toLayer(BotToolkit, handlers);
