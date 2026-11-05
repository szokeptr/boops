import {
  EnvironmentId,
  MessageId,
  ProjectId,
  RunId,
  RuntimeRequestId,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  botMonogram,
  deriveBotActivity,
  deriveBotList,
  resolveBotMainThreadId,
} from "./botList.ts";
import { presentThreadShell, scopeProject } from "./models.ts";
import { v2Project, v2ThreadShell } from "./orchestrationV2TestFixtures.ts";

const laptop = EnvironmentId.make("environment-laptop");
const vps = EnvironmentId.make("environment-vps");
const machineLabels = new Map([
  [laptop, "Laptop"],
  [vps, "VPS"],
]);

function at(iso: string) {
  return DateTime.makeUnsafe(iso);
}

function project(environmentId: EnvironmentId, id: string, title = id) {
  return scopeProject(environmentId, {
    ...v2Project,
    id: ProjectId.make(id),
    title,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  });
}

function thread(
  environmentId: EnvironmentId,
  projectId: string,
  id: string,
  overrides: Partial<OrchestrationV2ThreadShell> = {},
) {
  const threadId = ThreadId.make(id);
  return presentThreadShell(environmentId, {
    ...v2ThreadShell,
    id: threadId,
    projectId: ProjectId.make(projectId),
    title: id,
    lineage: { rootThreadId: threadId, parentThreadId: null, relationshipToParent: null },
    createdAt: at("2026-06-02T00:00:00.000Z"),
    updatedAt: at("2026-06-02T00:00:00.000Z"),
    ...overrides,
  });
}

function pendingRequest(kind: "command" | "user_input") {
  return {
    pendingRuntimeRequest: {
      id: RuntimeRequestId.make(`request-${kind}`),
      kind,
      createdAt: at("2026-06-02T00:00:00.000Z"),
    },
  };
}

function message(text: string, updatedAt: string, role: "user" | "assistant" = "assistant") {
  return {
    latestVisibleMessage: {
      id: MessageId.make(`message-${updatedAt}`),
      role,
      text,
      updatedAt: at(updatedAt),
    },
  };
}

describe("resolveBotMainThreadId", () => {
  it("reads the recorded main thread, else this environment's oldest live thread", () => {
    const bot = project(laptop, "bot");
    const archived = thread(laptop, "bot", "archived", {
      createdAt: at("2026-06-02T00:00:00.000Z"),
      archivedAt: at("2026-06-03T00:00:00.000Z"),
    });
    const oldest = thread(laptop, "bot", "oldest", { createdAt: at("2026-06-03T00:00:00.000Z") });
    const newer = thread(laptop, "bot", "newer", { createdAt: at("2026-06-04T00:00:00.000Z") });
    const otherEnvironment = thread(vps, "bot", "elsewhere", {
      createdAt: at("2026-05-01T00:00:00.000Z"),
    });
    const threads = [newer, archived, otherEnvironment, oldest];

    expect(resolveBotMainThreadId(bot, threads)).toBe(oldest.id);
    expect(resolveBotMainThreadId({ ...bot, mainThreadId: newer.id }, threads)).toBe(newer.id);
    expect(resolveBotMainThreadId(bot, [archived])).toBeNull();
  });
});

describe("deriveBotList", () => {
  const runId = RunId.make("run-1");

  it("maps thread states to bot statuses, taking the most urgent thread", () => {
    const projects = [
      project(laptop, "idle"),
      project(laptop, "working"),
      project(laptop, "approval"),
      project(laptop, "input"),
      project(laptop, "background"),
      project(laptop, "new"),
      project(laptop, "empty"),
      project(laptop, "dozing"),
      // Servers that record the persona: replies alone do not finish hatching.
      { ...project(laptop, "interviewing"), personaReady: false },
      { ...project(laptop, "hatched"), personaReady: true },
    ];
    const lastWord = message("see you", "2026-06-10T00:00:00.000Z");
    const threads = [
      thread(laptop, "idle", "idle-main", {
        latestRunId: runId,
        status: "completed",
        ...message("done", "2026-06-11T00:00:00.000Z"),
      }),
      thread(laptop, "new", "new-main"),
      thread(laptop, "dozing", "dozing-main", {
        latestRunId: runId,
        status: "completed",
        ...lastWord,
      }),
      thread(laptop, "working", "working-main", {
        latestRunId: runId,
        activeRunId: runId,
        status: "running",
      }),
      thread(laptop, "approval", "approval-main", pendingRequest("command")),
      thread(laptop, "input", "input-main", pendingRequest("user_input")),
      thread(laptop, "background", "background-main", { latestRunId: runId, status: "completed" }),
      thread(laptop, "interviewing", "interviewing-main", {
        latestRunId: runId,
        status: "completed",
        ...message("what should I call myself?", "2026-06-11T00:00:00.000Z"),
      }),
      thread(laptop, "hatched", "hatched-main", message("hi", "2026-06-11T00:00:00.000Z")),
      thread(laptop, "background", "background-run", {
        createdAt: at("2026-06-05T00:00:00.000Z"),
        ...pendingRequest("command"),
      }),
    ];

    const statusByBot = Object.fromEntries(
      deriveBotList({
        projects,
        threads,
        machineLabels,
        now: Date.parse("2026-06-11T00:00:00.000Z") + 1,
      }).map((row) => [row.projectId, row.status]),
    );

    expect(statusByBot).toEqual({
      idle: "idle",
      working: "working",
      approval: "needs-you",
      input: "needs-you",
      background: "needs-you",
      new: "hatching",
      empty: "hatching",
      dozing: "dozing",
      interviewing: "hatching",
      hatched: "idle",
    });
  });

  it("orders bots by their main thread's latest message across environments", () => {
    const projects = [
      project(laptop, "quiet", "Quiet"),
      project(vps, "chatty", "Chatty"),
      project(laptop, "empty", "Empty"),
      { ...project(vps, "archived"), archivedAt: "2026-06-01T00:00:00.000Z" },
      { ...project(laptop, "scratch"), isScratch: true as const },
    ];
    const threads = [
      thread(laptop, "quiet", "quiet-main", message("old news", "2026-06-03T00:00:00.000Z")),
      thread(
        vps,
        "chatty",
        "chatty-main",
        message("  hello\n\n  there ", "2026-06-09T00:00:00.000Z", "user"),
      ),
      // A newer background run does not move the bot; only the conversation does.
      thread(laptop, "quiet", "quiet-routine", {
        createdAt: at("2026-06-04T00:00:00.000Z"),
        ...message("routine", "2026-06-10T00:00:00.000Z"),
      }),
      thread(vps, "archived", "archived-main"),
    ];

    const rows = deriveBotList({ projects, threads, machineLabels });

    expect(
      rows.map((row) => ({
        key: row.key,
        machineLabel: row.machineLabel,
        mainThreadId: row.mainThreadId,
        lastMessagePreview: row.lastMessagePreview,
        lastMessageFromUser: row.lastMessageFromUser,
        activityThreadCount: row.activityThreadCount,
        lastActivityAt: row.lastActivityAt,
      })),
    ).toEqual([
      {
        key: `${vps}:chatty`,
        machineLabel: "VPS",
        mainThreadId: "chatty-main",
        lastMessagePreview: "hello there",
        lastMessageFromUser: true,
        activityThreadCount: 0,
        lastActivityAt: "2026-06-09T00:00:00.000Z",
      },
      {
        key: `${laptop}:quiet`,
        machineLabel: "Laptop",
        mainThreadId: "quiet-main",
        lastMessagePreview: "old news",
        lastMessageFromUser: false,
        activityThreadCount: 1,
        lastActivityAt: "2026-06-03T00:00:00.000Z",
      },
      {
        key: `${laptop}:empty`,
        machineLabel: "Laptop",
        mainThreadId: null,
        lastMessagePreview: null,
        lastMessageFromUser: false,
        activityThreadCount: 0,
        lastActivityAt: "2026-06-01T00:00:00.000Z",
      },
    ]);
  });

  it("marks a bot unread when its main thread finished after the last visit", () => {
    const projects = [project(laptop, "seen"), project(laptop, "unseen"), project(laptop, "local")];
    const finished = {
      latestRunId: runId,
      status: "completed" as const,
      latestRunCompletedAt: at("2026-06-05T00:00:00.000Z"),
    };
    // Servers without visit tracking leave lastVisitedAt out; the client's watermark counts.
    const { lastVisitedAt: _serverVisit, ...untracked } = thread(
      laptop,
      "local",
      "local-main",
      finished,
    );
    const threads = [
      thread(laptop, "seen", "seen-main", {
        ...finished,
        lastVisitedAt: at("2026-06-06T00:00:00.000Z"),
      }),
      thread(laptop, "unseen", "unseen-main", {
        ...finished,
        lastVisitedAt: at("2026-06-04T00:00:00.000Z"),
      }),
      untracked,
    ];

    const unreadByBot = Object.fromEntries(
      deriveBotList({
        projects,
        threads,
        machineLabels,
        localLastVisitedAt: { [`${laptop}:local-main`]: "2026-06-04T00:00:00.000Z" },
      }).map((row) => [row.projectId, row.unread]),
    );

    expect(unreadByBot).toEqual({ seen: false, unseen: true, local: true });
  });
});

describe("deriveBotActivity", () => {
  it("lists the bot's other live threads, most recent first", () => {
    const bot = project(laptop, "bot");
    const threads = [
      thread(laptop, "bot", "main", message("hi", "2026-06-20T00:00:00.000Z")),
      thread(laptop, "bot", "older-run", {
        createdAt: at("2026-06-03T00:00:00.000Z"),
        ...message("done", "2026-06-04T00:00:00.000Z"),
      }),
      thread(laptop, "bot", "newer-run", {
        createdAt: at("2026-06-05T00:00:00.000Z"),
        latestRunId: RunId.make("run-2"),
        activeRunId: RunId.make("run-2"),
        status: "running",
        ...message("working on it", "2026-06-06T00:00:00.000Z"),
      }),
      thread(laptop, "bot", "archived-run", {
        createdAt: at("2026-06-05T00:00:00.000Z"),
        archivedAt: at("2026-06-07T00:00:00.000Z"),
      }),
      thread(laptop, "other-bot", "foreign"),
    ];

    expect(
      deriveBotActivity({ project: bot, threads }).map((row) => [row.threadId, row.status]),
    ).toEqual([
      ["newer-run", "working"],
      ["older-run", "idle"],
    ]);
  });
});

describe("botMonogram", () => {
  it("uses two initials, or the first two letters of one word", () => {
    expect(botMonogram("Daily Digest")).toBe("DD");
    expect(botMonogram("scout")).toBe("SC");
    expect(botMonogram("  ")).toBe("?");
  });
});
