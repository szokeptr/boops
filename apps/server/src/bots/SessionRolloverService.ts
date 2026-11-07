import {
  CommandId,
  type ModelSelection,
  type ProjectId,
  type ServerSettings as ServerSettingsValue,
  type ThreadId,
} from "@t3tools/contracts";
import { modelSelectionsEqual } from "@t3tools/shared/model";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { forkParked } from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";

/**
 * Keeps a bot's model and its project's default model the same in both directions. Context
 * pressure is left to provider compaction; sessions roll over only when asked or on a model switch.
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
    yield* forkParked(
      Stream.runForEach(orchestrator.streamDomainEvents, (event) => {
        switch (event.type) {
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
