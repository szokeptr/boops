import { describe, expect, it } from "@effect/vitest";
import {
  MessageId,
  NodeId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  ProviderTurnId,
  RunId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import {
  contextRolloverRun,
  IDLE_ROLLOVER_AFTER_MS,
  idleRollover,
  type SessionRolloverRecords,
} from "./SessionRolloverTriggers.ts";

const NOW_MS = Date.parse("2026-11-05T12:00:00.000Z");
const at = (offset = 0) => DateTime.makeUnsafe(NOW_MS + offset);
const threadId = ThreadId.make("bot-thread");
const runId = RunId.make("run-1");
const messageId = MessageId.make("message-1");
const nodeId = NodeId.make("root-node");
const instanceId = ProviderInstanceId.make("claudeAgent");
const providerThreadId = ProviderThreadId.make("provider-thread");
const modelSelection = { instanceId, model: "claude-opus-5-5" };

function records(
  usedTokens: number,
  options: { readonly compacted?: boolean } = {},
): { -readonly [Key in keyof SessionRolloverRecords]: SessionRolloverRecords[Key] } {
  return {
    thread: {
      id: threadId,
      projectId: ProjectId.make("bot"),
      title: "Bot",
      createdBy: "user",
      creationSource: "server",
      providerInstanceId: instanceId,
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      activeProviderThreadId: providerThreadId,
      lineage: { rootThreadId: threadId, parentThreadId: null, relationshipToParent: null },
      forkedFrom: null,
      createdAt: at(-60_000),
      updatedAt: at(),
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      lastVisitedAt: at(),
      deletedAt: null,
    },
    runs: [
      {
        id: runId,
        threadId,
        ordinal: 1,
        providerInstanceId: instanceId,
        modelSelection,
        providerThreadId,
        userMessageId: messageId,
        rootNodeId: nodeId,
        activeAttemptId: null,
        status: "completed",
        requestedAt: at(-60_000),
        startedAt: at(-60_000),
        completedAt: at(),
        checkpointId: null,
        contextHandoffId: null,
      },
    ],
    messages: [
      {
        id: messageId,
        threadId,
        runId,
        nodeId,
        role: "user",
        text: "Plan my week",
        attachments: [],
        streaming: false,
        createdBy: "user",
        creationSource: "web",
        createdAt: at(-60_000),
        updatedAt: at(-60_000),
      },
    ],
    providerThreads: [],
    providerTurns: [
      {
        id: ProviderTurnId.make("provider-turn-1"),
        providerThreadId,
        nodeId,
        runAttemptId: null,
        nativeTurnRef: null,
        ordinal: 1,
        status: "completed",
        startedAt: at(-60_000),
        completedAt: at(),
        tokenUsage: { usedTokens, maxTokens: 200_000, updatedAt: DateTime.formatIso(at()) },
      },
    ],
    turnItems: options.compacted
      ? [
          {
            id: TurnItemId.make("compaction-1"),
            threadId,
            runId,
            nodeId,
            providerThreadId,
            providerTurnId: null,
            nativeItemRef: null,
            parentItemId: null,
            ordinal: 101,
            status: "completed",
            title: null,
            startedAt: at(-30_000),
            completedAt: at(-30_000),
            updatedAt: at(-30_000),
            type: "compaction",
            driver: ProviderDriverKind.make("claudeAgent"),
          },
        ]
      : [],
  };
}

/** The same thread once its rollover turn ran in the old session. */
function afterRolloverTurn(base: ReturnType<typeof records>) {
  const saveRun = {
    ...base.runs[0]!,
    id: RunId.make("run-2"),
    ordinal: 2,
    userMessageId: MessageId.make("save-notes"),
  };
  return {
    ...base,
    runs: [...base.runs, saveRun],
    messages: [
      ...base.messages,
      {
        ...base.messages[0]!,
        id: saveRun.userMessageId,
        runId: saveRun.id,
        createdBy: "system" as const,
        sessionRollover: { reason: "context_full" as const },
      },
    ],
  };
}

describe("contextRolloverRun", () => {
  it("gives provider compaction the first try, then fires once per filled session", () => {
    expect(contextRolloverRun(records(180_000))).toBeNull();
    expect(contextRolloverRun(records(160_000, { compacted: true }))).toBeNull();
    const full = records(180_000, { compacted: true });
    expect(contextRolloverRun(full)).toBe(runId);
    // A session that never reports a compaction still rolls over before the wall.
    expect(contextRolloverRun(records(191_000))).toBe(runId);
    // The rollover turn's own usage describes the session it ends.
    expect(contextRolloverRun(afterRolloverTurn(full))).toBeNull();
    // Once rolled over, the thread has no session until its next turn starts one.
    expect(
      contextRolloverRun({ ...full, thread: { ...full.thread, activeProviderThreadId: null } }),
    ).toBeNull();
    // A queued message will run first; its end decides.
    expect(
      contextRolloverRun({
        ...full,
        runs: [...full.runs, { ...full.runs[0]!, id: RunId.make("run-q"), status: "queued" }],
      }),
    ).toBeNull();
  });
});

describe("idleRollover", () => {
  it("waits the idle window on large sessions only, and not after a rollover turn", () => {
    expect(idleRollover(records(99_000))).toBeNull();
    const large = records(120_000);
    expect(idleRollover(large)).toEqual({ runId, atMs: NOW_MS + IDLE_ROLLOVER_AFTER_MS });
    expect(idleRollover(afterRolloverTurn(large))).toBeNull();
    expect(idleRollover({ ...large, thread: { ...large.thread, archivedAt: at() } })).toBeNull();
  });
});
