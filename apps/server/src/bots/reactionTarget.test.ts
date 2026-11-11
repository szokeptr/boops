import {
  MessageId,
  NodeId,
  type OrchestrationV2ConversationMessage,
  RunId,
  ScheduledTaskId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { latestReactableMessage } from "./reactionTarget.ts";

const message = (
  id: string,
  at: string,
  extra: Partial<OrchestrationV2ConversationMessage> = {},
): OrchestrationV2ConversationMessage => ({
  createdBy: "user" as const,
  creationSource: "mobile" as const,
  id: MessageId.make(id),
  threadId: ThreadId.make("wren"),
  runId: null,
  nodeId: null,
  role: "user" as const,
  text: id,
  attachments: [],
  streaming: false,
  createdAt: DateTime.makeUnsafe(at),
  updatedAt: DateTime.makeUnsafe(at),
  ...extra,
});

describe("latestReactableMessage", () => {
  it("picks the newest message someone wrote, whatever order the records come in", () => {
    // Records arrive in turn-item order; a delegated-task result has no item and sorts last.
    const delegated = message("delegated", "2026-11-08T18:03:10.517Z", {
      createdBy: "agent",
      creationSource: "server",
      delegatedCompletion: {
        parentRunId: RunId.make("run:1"),
        generation: 1,
        taskIds: [NodeId.make("node:task")],
      },
    });
    const liked = message("like my message", "2026-11-11T21:08:19.491Z");
    const routine = message("routine", "2026-11-11T21:09:00.000Z", {
      routine: {
        taskId: ScheduledTaskId.make("heartbeat"),
        name: "Heartbeat",
        trigger: "interval",
      },
    });
    expect(
      latestReactableMessage([message("hi", "2026-11-11T21:08:09.587Z"), liked, routine, delegated])
        ?.id,
    ).toBe(liked.id);
    expect(latestReactableMessage([delegated, routine])).toBeUndefined();
  });
});
