import {
  type BotCreateInput,
  type BotCreateResult,
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { familySpec, specFor } from "@t3tools/shared/botAvatar";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { newProjectFolderName } from "@t3tools/shared/path";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";

export class BotHomeFolderError extends Schema.TaggedError<BotHomeFolderError>()(
  "BotHomeFolderError",
  {
    folder: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Failed to create the bot's home folder.";
  }
}

export class BotCreateError extends Schema.TaggedError<BotCreateError>()("BotCreateError", {
  stage: Schema.Literals(["project", "main-thread"]),
  workspaceRoot: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return this.stage === "project"
      ? "Failed to create the bot."
      : "Created the bot, but failed to start its conversation.";
  }
}

export class Bots extends Context.Service<
  Bots,
  {
    /**
     * Creates `~/pocks/<slug>/` with `memory/`, a project rooted there, its main thread, and a
     * heartbeat routine. Without a picked avatar, its look steps away from the environment's other bots.
     */
    readonly create: (
      input: BotCreateInput,
    ) => Effect.Effect<BotCreateResult, BotHomeFolderError | BotCreateError>;
  }
>()("t3/bots/Bots") {}

const MAX_SLUG_ATTEMPTS = 100;

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const projects = yield* ProjectService.ProjectService;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const routines = yield* ScheduledTaskService.ScheduledTaskService;
  const random = yield* SecureRandom.SecureRandom;

  // Non-recursive mkdir atomically claims a slug; a taken one moves on to `<slug>-2`.
  const claimHome = Effect.fn("Bots.claimHome")(function* (name: string) {
    const root = path.join(yield* HostProcess.HomeDirectory, "pocks");
    yield* fileSystem
      .makeDirectory(root, { recursive: true })
      .pipe(Effect.mapError((cause) => new BotHomeFolderError({ folder: root, cause })));
    const slug = newProjectFolderName(name);
    for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt++) {
      const folder = path.join(root, attempt === 1 ? slug : `${slug}-${attempt}`);
      const claimed = yield* fileSystem.makeDirectory(folder).pipe(
        Effect.as(true),
        Effect.catchIf(
          (error) => error.reason._tag === "AlreadyExists",
          () => Effect.succeed(false),
        ),
        Effect.mapError((cause) => new BotHomeFolderError({ folder, cause })),
      );
      if (claimed) return folder;
    }
    return yield* new BotHomeFolderError({
      folder: path.join(root, slug),
      cause: `Every folder name for "${slug}" is taken.`,
    });
  });

  const create: Bots["Service"]["create"] = Effect.fn("Bots.create")(function* (input) {
    const workspaceRoot = yield* claimHome(input.name);
    const removeHome = fileSystem.remove(workspaceRoot, { recursive: true }).pipe(Effect.ignore);
    const id = yield* Effect.all([
      fileSystem
        .makeDirectory(path.join(workspaceRoot, "memory"))
        .pipe(Effect.mapError((cause) => new BotHomeFolderError({ folder: workspaceRoot, cause }))),
      random
        .uuidV4()
        .pipe(
          Effect.mapError(
            (cause) => new BotCreateError({ stage: "project", workspaceRoot, cause }),
          ),
        ),
    ]).pipe(
      Effect.map(([, uuid]) => uuid),
      Effect.onExit((exit) => (Exit.isSuccess(exit) ? Effect.void : removeHome)),
    );
    const project = yield* projects
      .create({
        commandId: CommandId.make(`bot-project:${id}`),
        projectId: ProjectId.make(id),
        title: input.name,
        workspaceRoot,
        defaultModelSelection: input.modelSelection,
      })
      .pipe(
        // An interrupted or conflicting create can still leave an owner; only an unowned home goes.
        Effect.tapError(() =>
          projects.getByWorkspaceRoot(workspaceRoot).pipe(
            Effect.flatMap((owner) => (Option.isNone(owner) ? removeHome : Effect.void)),
            Effect.ignore,
          ),
        ),
        Effect.mapError((cause) => new BotCreateError({ stage: "project", workspaceRoot, cause })),
      );
    const mainThreadId = ThreadId.make(id);
    yield* threads
      .dispatch({
        type: "thread.create",
        createdBy: "user",
        creationSource: "server",
        commandId: CommandId.make(`bot-main-thread:${id}`),
        threadId: mainThreadId,
        projectId: project.id,
        title: input.name,
        modelSelection: input.modelSelection,
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        branch: null,
        worktreePath: null,
      })
      .pipe(
        Effect.andThen(
          input.avatar === undefined
            ? projects.listShells().pipe(
                Effect.map((shells) =>
                  familySpec(
                    input.name,
                    shells
                      .filter((shell) => shell.id !== project.id)
                      .map((shell) => shell.avatar ?? specFor(shell.title)),
                  ),
                ),
              )
            : Effect.succeed(input.avatar),
        ),
        Effect.flatMap((avatar) =>
          projects.update({
            commandId: CommandId.make(`bot-main-thread-record:${id}`),
            projectId: project.id,
            mainThreadId,
            avatar,
          }),
        ),
        Effect.mapError(
          (cause) => new BotCreateError({ stage: "main-thread", workspaceRoot, cause }),
        ),
      );
    // The bot works without it, and the user can add one, so a failure does not undo the bot.
    yield* routines
      .ensureDefaultHeartbeat({ projectId: project.id, threadId: mainThreadId })
      .pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Could not add the bot's heartbeat", { projectId: project.id, cause }),
        ),
      );
    return { projectId: project.id, mainThreadId };
  });

  return Bots.of({ create });
});

export const layer = Layer.effect(Bots, make);
