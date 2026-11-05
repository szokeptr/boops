import { CommandId, type ProjectId } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { forkParked } from "../serverActivation.ts";

export const PERSONA_FILE = "PERSONA.md";

const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "interrupted", "cancelled"]);

/**
 * Records whether a bot has hatched (its home folder has a PERSONA.md) on its project. The
 * bot writes the file itself during a turn, so a check after every run is the only signal.
 */
export const makeRefresh = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const projects = yield* ProjectService.ProjectService;

  /** `reason` keeps each check's command id unique: a persona can come, go and come back. */
  return Effect.fn("BotPersona.refresh")(
    function* (projectId: ProjectId, reason: string) {
      const project = yield* projects.getById(projectId);
      if (Option.isNone(project)) return;
      const personaReady = yield* fileSystem
        .exists(path.join(project.value.workspaceRoot, PERSONA_FILE))
        .pipe(Effect.orElseSucceed(() => false));
      if (personaReady === (project.value.personaReady ?? false)) return;
      yield* projects.update({
        commandId: CommandId.make(`bot-persona:${projectId}:${reason}`),
        projectId,
        personaReady,
      });
    },
    (effect, projectId) =>
      effect.pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Could not check the bot's persona", { projectId, cause }),
        ),
      ),
  );
});

export const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectService.ProjectService;
  const refresh = yield* makeRefresh;

  const start = Effect.fn("BotPersona.start")(function* () {
    const startedAt = yield* Clock.currentTimeMillis;
    // Catches files written while the server was down, and bots from before this was recorded.
    yield* forkParked(
      projects.listShells().pipe(
        Effect.flatMap((shells) =>
          Effect.forEach(shells, (shell) => refresh(shell.id, `startup:${startedAt}`), {
            discard: true,
          }),
        ),
        Effect.catch((cause) => Effect.logWarning("Could not check bot personas", { cause })),
      ),
    );
    yield* forkParked(
      Stream.runForEach(orchestrator.streamDomainEvents, (event) =>
        event.type === "run.updated" && TERMINAL_RUN_STATUSES.has(event.payload.status)
          ? projections.getThread(event.threadId).pipe(
              Effect.flatMap((thread) =>
                refresh(thread.projectId, `run:${event.payload.id}:${event.payload.status}`),
              ),
              Effect.ignore,
            )
          : Effect.void,
      ),
    );
  });
  return { start };
});
