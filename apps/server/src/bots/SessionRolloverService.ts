import {
  CommandId,
  type ModelSelection,
  type ProjectId,
  type RunId,
  type ServerSettings as ServerSettingsValue,
  type ThreadId,
} from "@t3tools/contracts";
import { modelSelectionsEqual } from "@t3tools/shared/model";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { forkParked } from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";
import { contextRolloverRun, idleRollover } from "./SessionRolloverTriggers.ts";

/**
 * Rolls a bot's conversation over to a fresh provider session when its context fills or it goes
 * idle, and keeps the bot's model and its project's default model the same in both directions.
 * Idle timers live in memory; startup re-arms them from each bot's latest run.
 */
export const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectService.ProjectService;
  const settings = yield* ServerSettings.ServerSettingsService;

  const botProjectOf = Effect.fn("SessionRolloverService.botProjectOf")(function* (
    threadId: ThreadId,
  ) {
    const thread = yield* projections.getThread(threadId);
    const shell = Option.getOrUndefined(yield* projects.getShell(thread.projectId));
    return shell?.mainThreadId === threadId ? shell.id : null;
  });

  const readRecords = Effect.fn("SessionRolloverService.readRecords")(function* (
    threadId: ThreadId,
  ) {
    const { thread, runs } = yield* projections.getThreadRecords(threadId, ["runs"], {
      runStatuses: ["queued", "preparing", "starting", "running", "waiting"],
      includeLatestRun: true,
    });
    const active = thread.activeProviderThreadId === null ? [] : [thread.activeProviderThreadId];
    const rest = yield* projections.getThreadRecords(
      threadId,
      ["messages", "providerThreads", "providerTurns", "turnItems"],
      {
        messageRunIds: runs.map((run) => run.id),
        providerThreadIds: active,
        providerTurnThreadIds: active,
        latestProviderTurnUsageOnly: true,
        turnItemTypes: ["compaction"],
      },
    );
    return { ...rest, thread, runs };
  });

  const rollover = (threadId: ThreadId, key: string, reason: "context_full" | "idle") =>
    orchestrator.dispatch({
      type: "thread.session.rollover",
      // One rollover per run a session ended on, even across duplicate events.
      commandId: CommandId.make(`server:session-rollover:${key}`),
      threadId,
      reason,
    });

  const idleWhenDue = Effect.fn("SessionRolloverService.idleWhenDue")(
    function* (threadId: ThreadId) {
      while (true) {
        const due = idleRollover(yield* readRecords(threadId));
        if (due === null) return;
        const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
        if (nowMs < due.atMs) {
          yield* Effect.sleep(Duration.millis(due.atMs - nowMs));
          continue;
        }
        yield* rollover(threadId, `idle:${due.runId}`, "idle");
        return;
      }
    },
    (effect, threadId) =>
      effect.pipe(
        Effect.catch((cause) => Effect.logWarning("idle rollover skipped", { threadId, cause })),
      ),
  );

  const afterRun = Effect.fn("SessionRolloverService.afterRun")(
    function* (threadId: ThreadId, _runId: RunId, timers: FiberMap.FiberMap<ThreadId>) {
      if ((yield* botProjectOf(threadId)) === null) return;
      const due = contextRolloverRun(yield* readRecords(threadId));
      if (due !== null) {
        yield* rollover(threadId, `context:${due}`, "context_full");
        return;
      }
      yield* FiberMap.run(timers, threadId, idleWhenDue(threadId));
    },
    (effect, threadId) =>
      effect.pipe(
        Effect.catch((cause) => Effect.logWarning("context rollover skipped", { threadId, cause })),
      ),
  );

  // The bot's model is its conversation's; new threads in its project follow it.
  const followThreadModel = Effect.fn("SessionRolloverService.followThreadModel")(
    function* (threadId: ThreadId, selection: ModelSelection) {
      const projectId = yield* botProjectOf(threadId);
      if (projectId === null) return;
      const current = yield* settings.getSettings;
      const overrides = current.projectSettingsOverrides[projectId] ?? {};
      if (
        overrides.defaultModelSelection != null &&
        modelSelectionsEqual(overrides.defaultModelSelection, selection)
      )
        return;
      yield* settings.updateSettings({
        projectSettingsOverrides: {
          [projectId]: { ...overrides, defaultModelSelection: selection },
        },
      });
    },
    (effect, threadId) =>
      effect.pipe(
        Effect.catch((cause) =>
          Effect.logWarning("bot default model not saved", { threadId, cause }),
        ),
      ),
  );

  // A default model picked in the bot's settings switches its conversation through a rollover.
  const followProjectDefault = Effect.fn("SessionRolloverService.followProjectDefault")(
    function* (projectId: ProjectId, selection: ModelSelection) {
      const shell = Option.getOrUndefined(yield* projects.getShell(projectId));
      const threadId = shell?.mainThreadId;
      if (threadId == null) return;
      const thread = yield* projections.getThread(threadId);
      if (modelSelectionsEqual(thread.modelSelection, selection)) return;
      const nonce = DateTime.toEpochMillis(yield* DateTime.now);
      yield* orchestrator.dispatch({
        type: "thread.session.rollover",
        commandId: CommandId.make(`server:session-rollover:settings:${threadId}:${nonce}`),
        threadId,
        reason: "model_switch",
        modelSelection: selection,
      });
    },
    (effect, projectId) =>
      effect.pipe(
        Effect.catch((cause) =>
          Effect.logWarning("bot model switch from settings skipped", { projectId, cause }),
        ),
      ),
  );

  const start = Effect.fn("SessionRolloverService.start")(function* () {
    const timers = yield* FiberMap.make<ThreadId>();
    yield* forkParked(
      Effect.gen(function* () {
        const shells = yield* projects.listShells();
        for (const shell of shells) {
          if (shell.mainThreadId != null) {
            yield* FiberMap.run(timers, shell.mainThreadId, idleWhenDue(shell.mainThreadId));
          }
        }
      }).pipe(
        Effect.catch((cause) => Effect.logWarning("idle rollover timers not armed", { cause })),
      ),
    );
    yield* forkParked(
      Stream.runForEach(orchestrator.streamDomainEvents, (event) => {
        switch (event.type) {
          case "run.updated":
            return event.payload.status === "completed" ||
              event.payload.status === "failed" ||
              event.payload.status === "interrupted"
              ? afterRun(event.threadId, event.payload.id, timers)
              : Effect.void;
          case "thread.provider-switched":
          case "thread.model-selection-updated":
            return followThreadModel(event.threadId, event.payload.modelSelection);
          default:
            return Effect.void;
        }
      }),
    );
    const defaults = (overrides: ServerSettingsValue["projectSettingsOverrides"]) =>
      Object.fromEntries(
        Object.entries(overrides).map(([id, entry]) => [id, entry?.defaultModelSelection]),
      );
    let previous = defaults((yield* settings.getSettings).projectSettingsOverrides);
    yield* forkParked(
      Stream.runForEach(settings.streamChanges, (next) =>
        Effect.gen(function* () {
          const seen = previous;
          previous = defaults(next.projectSettingsOverrides);
          for (const [id, selection] of Object.entries(previous)) {
            const before = seen[id];
            if (selection == null || (before != null && modelSelectionsEqual(before, selection)))
              continue;
            yield* followProjectDefault(id as ProjectId, selection);
          }
        }),
      ),
    );
  });
  return { start };
});
