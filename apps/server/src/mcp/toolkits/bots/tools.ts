import {
  BotCreateResult,
  BotMcpCreateChildInput,
  BotMcpDelivery,
  BotMcpListGroupChatsResult,
  BotMcpPostToGroupChatInput,
  BotMcpEndCallResult,
  BotMcpListBotsResult,
  BotMcpMessageBotInput,
  BotMcpMessageChildInput,
  BotMcpReadChildInput,
  BotMcpReadChildResult,
  BotMcpReportToParentInput,
  BotMcpTellMainConversationInput,
  OrchestratorMcpFailure,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as BotCalls from "../../../bots/BotCalls.ts";
import * as Bots from "../../../bots/Bots.ts";
import * as Rooms from "../../../rooms/Rooms.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  Bots.Bots,
];

const EndCallTool = Tool.make("end_call", {
  description:
    "Hang up the user's voice call with you, when a message said on the call asks to end it or says goodbye. Your voice has already said goodbye, so don't reply with another one.",
  success: BotMcpEndCallResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [...dependencies, BotCalls.BotCalls],
})
  .annotate(Tool.Title, "End the voice call")
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const CreateChildBotTool = Tool.make("create_child_bot", {
  description:
    "Create a new bot on this machine for separate, lasting work, when the user asks for one. You become its parent. Usually shows the user an approval card. `mode`: interview, or brief to skip the interview.",
  parameters: BotMcpCreateChildInput,
  success: BotCreateResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Create a child bot")
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, true);

const ListBotsTool = Tool.make("list_bots", {
  description:
    "List the other bots you can message: your parent, the bots you created, your siblings, and any bot that talks with any bot.",
  success: BotMcpListBotsResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "List bots")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

const ReadChildBotTool = Tool.make("read_child_bot", {
  description: "Read the latest messages of a bot you created.",
  parameters: BotMcpReadChildInput,
  success: BotMcpReadChildResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Read a child bot")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

const MessageChildBotTool = Tool.make("message_child_bot", {
  description:
    "Send a message to a bot you created. It is queued behind its current turn. It answers with report_to_parent.",
  parameters: BotMcpMessageChildInput,
  success: BotMcpDelivery,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Message a child bot")
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, true);

const MessageBotTool = Tool.make("message_bot", {
  description:
    "Send a message to another bot from list_bots, into its conversation, as yourself. It is queued behind its current turn, and its answer comes back the same way. Never write into another bot's threads with thread tools.",
  parameters: BotMcpMessageBotInput,
  success: BotMcpDelivery,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Message a bot")
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, true);

const ReportToParentTool = Tool.make("report_to_parent", {
  description:
    "Send a message to the bot that created you, into its conversation. Not for secrets or approvals: those go to the user.",
  parameters: BotMcpReportToParentInput,
  success: BotMcpDelivery,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Report to the parent bot")
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, true);

const TellMainConversationTool = Tool.make("tell_main_conversation", {
  description:
    "From one of your background threads, such as a Heartbeat or routine run, post a short note into your main conversation with the user, where you then tell them. Only for what needs the user; not from the main conversation itself.",
  parameters: BotMcpTellMainConversationInput,
  success: BotMcpDelivery,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Tell the main conversation")
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false);

const ListGroupChatsTool = Tool.make("list_group_chats", {
  description:
    "List the group chats you are in, with the people and other bots in each. Your replies to messages in a group chat reach it on their own; use post_to_group_chat only to speak up unprompted.",
  success: BotMcpListGroupChatsResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [...dependencies, Rooms.Rooms],
})
  .annotate(Tool.Title, "List group chats")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

const PostToGroupChatTool = Tool.make("post_to_group_chat", {
  description:
    "Post a message as yourself in a group chat you are in, from a routine or when the user asks you to tell the group something. Everyone in it sees it; @Name another bot to hand it something. Not for replying in the group chat you were asked in: that reply posts itself.",
  parameters: BotMcpPostToGroupChatInput,
  success: Schema.Struct({ posted: Schema.Boolean }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [...dependencies, Rooms.Rooms],
})
  .annotate(Tool.Title, "Post to a group chat")
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, true);

export const BotToolkit = Toolkit.make(
  CreateChildBotTool,
  ListBotsTool,
  ReadChildBotTool,
  MessageChildBotTool,
  MessageBotTool,
  ReportToParentTool,
  TellMainConversationTool,
  EndCallTool,
  ListGroupChatsTool,
  PostToGroupChatTool,
);
