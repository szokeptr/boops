import {
  BotCreateResult,
  BotMcpCreateChildInput,
  BotMcpDelivery,
  BotMcpEndCallResult,
  BotMcpListChildrenResult,
  BotMcpMessageChildInput,
  BotMcpReadChildInput,
  BotMcpReadChildResult,
  BotMcpReportToParentInput,
  BotMcpTellMainConversationInput,
  OrchestratorMcpFailure,
} from "@t3tools/contracts";
import { Tool, Toolkit } from "effect/ai";

import * as BotCalls from "../../../bots/BotCalls.ts";
import * as Bots from "../../../bots/Bots.ts";
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

const ListChildBotsTool = Tool.make("list_child_bots", {
  description: "List the bots you created.",
  success: BotMcpListChildrenResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "List child bots")
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
    "From one of your background threads, such as a Heartbeat run, post a short note into your main conversation with the user, where you then tell them. Only for what needs the user; not from the main conversation itself.",
  parameters: BotMcpTellMainConversationInput,
  success: BotMcpDelivery,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Tell the main conversation")
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false);

export const BotToolkit = Toolkit.make(
  CreateChildBotTool,
  ListChildBotsTool,
  ReadChildBotTool,
  MessageChildBotTool,
  ReportToParentTool,
  TellMainConversationTool,
  EndCallTool,
);
