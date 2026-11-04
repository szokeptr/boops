import {
  type BotArchiveInput,
  type BotArchiveResult,
  type BotChildStart,
  type BotCreateInput,
  type BotCreateResult,
  type BotDeleteInput,
  type BotFamilyAuthor,
  type BotMcpDelivery,
  type BotUnarchiveInput,
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  MessageId,
  type ModelSelection,
  type OrchestrationProjectShell,
  type Project,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { familySpec, specFor } from "@t3tools/shared/botAvatar";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { newProjectFolderName } from "@t3tools/shared/path";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
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
import { BotFamilyError } from "./botFamily.ts";

export class BotHomeFolderError extends Schema.TaggedError<BotHomeFolderError>()(
  "BotHomeFolderError",
  {
    folder: Schema.String,
    action: Schema.optional(Schema.Literals(["create", "remove"])),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return this.action === "remove"
      ? "Deleted the bot, but failed to remove its home folder."
      : "Failed to create the bot's home folder.";
  }
}

export class BotFolderNotRemovableError extends Schema.TaggedError<BotFolderNotRemovableError>()(
  "BotFolderNotRemovableError",
  { folder: Schema.String },
) {
  override get message(): string {
    return "Only a home folder inside ~/pocks is removed with its bot. Delete it without removing the folder.";
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

export interface BotCreateChildInput {
  readonly parentProjectId: ProjectId;
  readonly name: string;
  /** Defaults to the parent's model. */
  readonly modelSelection?: ModelSelection;
  readonly mode: BotChildStart;
  readonly brief?: string;
}

/** What the user approves when a bot without the bypass creates another. */
export interface BotChildApproval {
  readonly parentName: string;
  readonly childName: string;
  readonly mode: BotChildStart;
  readonly brief?: string;
}

export interface BotFamilyMessage {
  readonly author: BotFamilyAuthor;
  readonly text: string;
  readonly createdAt: string;
}

export class BotNotFoundError extends Schema.TaggedError<BotNotFoundError>()("BotNotFoundError", {
  projectId: ProjectId,
}) {
  override get message(): string {
    return "The bot was not found.";
  }
}

export class BotLifecycleError extends Schema.TaggedError<BotLifecycleError>()(
  "BotLifecycleError",
  {
    operation: Schema.Literals(["archive", "unarchive", "delete"]),
    projectId: ProjectId,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to ${this.operation} the bot.`;
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
    /**
     * A bot creates a child bot. Unless the parent may create bots without asking, `askUser`
     * must approve first. A brief replaces the hatching interview as the child's first turn.
     */
    readonly createChild: <E>(
      input: BotCreateChildInput,
      askUser: (approval: BotChildApproval) => Effect.Effect<boolean, E>,
    ) => Effect.Effect<BotCreateResult, E | BotFamilyError | BotHomeFolderError | BotCreateError>;
    /** Bots whose parent is `projectId`, archived ones included. */
    readonly childrenOf: (
      projectId: ProjectId,
    ) => Effect.Effect<ReadonlyArray<OrchestrationProjectShell>, BotFamilyError>;
    /** The latest messages of a child's conversation, oldest first. */
    readonly readChild: (input: {
      readonly parentProjectId: ProjectId;
      readonly childProjectId: ProjectId;
      readonly limit: number;
    }) => Effect.Effect<ReadonlyArray<BotFamilyMessage>, BotFamilyError>;
    readonly messageChild: (input: {
      readonly parentProjectId: ProjectId;
      readonly childProjectId: ProjectId;
      readonly text: string;
    }) => Effect.Effect<BotMcpDelivery, BotFamilyError>;
    /** Posts into the parent's conversation, labelled as from the child. */
    readonly reportToParent: (input: {
      readonly childProjectId: ProjectId;
      readonly text: string;
    }) => Effect.Effect<BotMcpDelivery, BotFamilyError>;
    /**
     * Pauses the bot's routines and heartbeat and hides it from the bot list; its threads and
     * home folder stay. `includeChildren` also archives the live bots below it. Returns every bot
     * it archived.
     */
    readonly archive: (
      input: BotArchiveInput,
    ) => Effect.Effect<BotArchiveResult, BotNotFoundError | BotLifecycleError>;
    /** Brings the bot back and turns on only the routines archiving paused. */
    readonly unarchive: (
      input: BotUnarchiveInput,
    ) => Effect.Effect<void, BotNotFoundError | BotLifecycleError>;
    /**
     * Removes the bot's routines, threads and project. The home folder goes only when asked, and
     * only when it lies inside `~/pocks/`.
     */
    readonly delete: (
      input: BotDeleteInput,
    ) => Effect.Effect<
      void,
      BotNotFoundError | BotFolderNotRemovableError | BotHomeFolderError | BotLifecycleError
    >;
  }
>()("t3/bots/Bots") {}

const MAX_SLUG_ATTEMPTS = 100;

// The injected bot instructions drive the interview; this only gives the bot its first turn.
export const HATCH_KICKOFF_TEXT = "You were just created. Start hatching.";

export const childHatchKickoffText = (parentName: string) =>
  `You were just created by ${parentName}, another bot. Start hatching.`;

export const childBriefKickoffText = (parentName: string, brief: string) =>
  `You were just created by ${parentName}, another bot, from this brief instead of a hatching interview. Write PERSONA.md and your first memory notes from it, add a routine if it calls for one, then start. Tell ${parentName} what matters with report_to_parent.\n\nBrief:\n${brief}`;

// Agents read who sent a family message from this line; people see the sender on the message row.
const fromParentHeader = (parentName: string) =>
  `[From ${parentName}, your parent bot. Answer with report_to_parent.]`;
const fromChildHeader = (childName: string) =>
  `[From ${childName}, a bot you created. Answer with message_child_bot.]`;

const READ_TEXT_MAX_CHARS = 4_000;

interface Kickoff {
  readonly text: string;
  /** The parent's conversation, when another bot starts this one. */
  readonly senderThreadId?: ThreadId;
}

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

  // A bot that missed its kickoff still hatches on the user's first message, so this never fails create.
  const kickOff = (id: string, threadId: ThreadId, kickoff: Kickoff) =>
    threads
      .dispatch({
        type: "message.dispatch",
        commandId: CommandId.make(`bot-hatch:${id}`),
        messageId: MessageId.make(`bot-hatch:${id}`),
        threadId,
        text: kickoff.text,
        attachments: [],
        createdBy: kickoff.senderThreadId === undefined ? "system" : "agent",
        creationSource: "server",
        ...(kickoff.senderThreadId === undefined ? {} : { senderThreadId: kickoff.senderThreadId }),
        dispatchMode: { type: "start_immediately" },
      })
      .pipe(
        Effect.asVoid,
        Effect.catch((cause) =>
          Effect.logWarning("bot hatching kickoff failed", { threadId, cause }),
        ),
      );

  const createBot = Effect.fn("Bots.create")(function* (
    input: Omit<BotCreateInput, "hatch">,
    family: { readonly parentBotProjectId?: ProjectId; readonly kickoff: Kickoff | null },
  ) {
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
            ...(family.parentBotProjectId === undefined
              ? {}
              : { parentBotProjectId: family.parentBotProjectId }),
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
    if (family.kickoff !== null) yield* kickOff(id, mainThreadId, family.kickoff);
    return { projectId: project.id, mainThreadId } satisfies BotCreateResult;
  });

  const create: Bots["Service"]["create"] = ({ hatch, ...input }) =>
    createBot(input, { kickoff: (hatch ?? true) ? { text: HATCH_KICKOFF_TEXT } : null });

  const familyError = (reason: BotFamilyError["reason"], detail: string) =>
    new BotFamilyError({ reason, detail });

  const requireBot = Effect.fn("Bots.requireBot")(function* (projectId: ProjectId) {
    const project = yield* projects
      .getById(projectId)
      .pipe(Effect.mapError(() => familyError("unavailable", "Could not read the bot.")));
    if (Option.isNone(project)) {
      return yield* familyError("not-found", `No bot has projectId ${projectId}.`);
    }
    return project.value;
  });

  const conversationOf = (bot: Project) =>
    bot.mainThreadId == null
      ? Effect.fail(familyError("not-found", `${bot.title} has no conversation yet.`))
      : Effect.succeed(bot.mainThreadId);

  const requireChild = Effect.fn("Bots.requireChild")(function* (
    parentProjectId: ProjectId,
    childProjectId: ProjectId,
  ) {
    const child = yield* requireBot(childProjectId);
    if (child.parentBotProjectId !== parentProjectId) {
      return yield* familyError("unrelated", `${child.title} is not a bot you created.`);
    }
    return child;
  });

  const postInto = Effect.fn("Bots.postInto")(function* (input: {
    readonly to: Project;
    readonly from: Project;
    readonly header: string;
    readonly text: string;
  }) {
    const threadId = yield* conversationOf(input.to);
    const senderThreadId = yield* conversationOf(input.from);
    const id = yield* random
      .uuidV4()
      .pipe(Effect.mapError(() => familyError("unavailable", "Could not send the message.")));
    // Queued like a routine run, so it never cuts into a turn in progress.
    const sent = yield* threads
      .sendToThread({
        projectId: input.to.id,
        threadId,
        commandId: CommandId.make(`bot-family:${id}`),
        messageId: MessageId.make(`bot-family:${id}`),
        senderThreadId,
        text: `${input.header}\n\n${input.text}`,
        attachments: [],
        mode: "queue",
        createdBy: "agent",
        creationSource: "server",
      })
      .pipe(
        Effect.mapError((cause) =>
          familyError("unavailable", `Could not reach ${input.to.title}: ${cause.message}`),
        ),
      );
    return { delivery: sent.delivery } satisfies BotMcpDelivery;
  });

  const createChild: Bots["Service"]["createChild"] = Effect.fn("Bots.createChild")(function* <E>(
    input: BotCreateChildInput,
    askUser: (approval: BotChildApproval) => Effect.Effect<boolean, E>,
  ) {
    const parent = yield* requireBot(input.parentProjectId);
    const parentThreadId = yield* conversationOf(parent);
    if (input.mode === "brief" && input.brief === undefined) {
      return yield* familyError("invalid", "A child started from a brief needs `brief`.");
    }
    const modelSelection = input.modelSelection ?? parent.defaultModelSelection;
    if (modelSelection === null) {
      return yield* familyError("invalid", `${parent.title} has no model for the child to use.`);
    }
    if (parent.canCreateBotsWithoutAsking !== true) {
      const approved = yield* askUser({
        parentName: parent.title,
        childName: input.name,
        mode: input.mode,
        ...(input.mode === "brief" && input.brief !== undefined ? { brief: input.brief } : {}),
      });
      if (!approved) {
        return yield* familyError("declined", `The user declined creating ${input.name}.`);
      }
    }
    return yield* createBot(
      { name: input.name, modelSelection },
      {
        parentBotProjectId: parent.id,
        kickoff:
          input.mode === "brief" && input.brief !== undefined
            ? {
                text: childBriefKickoffText(parent.title, input.brief),
                senderThreadId: parentThreadId,
              }
            : { text: childHatchKickoffText(parent.title) },
      },
    );
  });

  const childrenOf: Bots["Service"]["childrenOf"] = Effect.fn("Bots.childrenOf")(
    function* (projectId) {
      const shells = yield* projects
        .listShells()
        .pipe(Effect.mapError(() => familyError("unavailable", "Could not read the bots.")));
      return shells.filter((shell) => shell.parentBotProjectId === projectId);
    },
  );

  const readChild: Bots["Service"]["readChild"] = Effect.fn("Bots.readChild")(function* (input) {
    const parent = yield* requireBot(input.parentProjectId);
    const child = yield* requireChild(input.parentProjectId, input.childProjectId);
    const threadId = yield* conversationOf(child);
    const records = yield* threads
      .getThreadRecords(threadId, ["messages"], { messageRoles: ["user", "assistant"] })
      .pipe(Effect.mapError(() => familyError("unavailable", `Could not read ${child.title}.`)));
    const authorOf = (message: (typeof records.messages)[number]): BotFamilyAuthor =>
      message.role === "assistant"
        ? "child"
        : message.routine !== undefined
          ? "routine"
          : parent.mainThreadId != null && message.senderThreadId === parent.mainThreadId
            ? "you"
            : message.createdBy === "user"
              ? "user"
              : "system";
    return records.messages.slice(-input.limit).map((message): BotFamilyMessage => ({
      author: authorOf(message),
      text:
        message.text.length > READ_TEXT_MAX_CHARS
          ? `${message.text.slice(0, READ_TEXT_MAX_CHARS)}…`
          : message.text,
      createdAt: DateTime.formatIso(message.createdAt),
    }));
  });

  const messageChild: Bots["Service"]["messageChild"] = Effect.fn("Bots.messageChild")(
    function* (input) {
      const parent = yield* requireBot(input.parentProjectId);
      const child = yield* requireChild(input.parentProjectId, input.childProjectId);
      return yield* postInto({
        to: child,
        from: parent,
        header: fromParentHeader(parent.title),
        text: input.text,
      });
    },
  );

  const reportToParent: Bots["Service"]["reportToParent"] = Effect.fn("Bots.reportToParent")(
    function* (input) {
      const child = yield* requireBot(input.childProjectId);
      if (child.parentBotProjectId == null) {
        return yield* familyError("not-found", "No bot created you, so there is no parent.");
      }
      const parent = yield* requireBot(child.parentBotProjectId);
      return yield* postInto({
        to: parent,
        from: child,
        header: fromChildHeader(child.title),
        text: input.text,
      });
    },
  );

  const readBot = Effect.fn("Bots.readBot")(function* (
    operation: BotLifecycleError["operation"],
    projectId: ProjectId,
  ) {
    const project = yield* projects
      .getById(projectId)
      .pipe(Effect.mapError((cause) => new BotLifecycleError({ operation, projectId, cause })));
    if (Option.isNone(project)) return yield* new BotNotFoundError({ projectId });
    return project.value;
  });

  const lifecycleCommandId = Effect.fn("Bots.lifecycleCommandId")(function* (
    operation: BotLifecycleError["operation"],
    projectId: ProjectId,
  ) {
    const id = yield* random
      .uuidV4()
      .pipe(Effect.mapError((cause) => new BotLifecycleError({ operation, projectId, cause })));
    return CommandId.make(`bot-${operation}:${id}`);
  });

  const setArchived = Effect.fn("Bots.setArchived")(function* (
    projectId: ProjectId,
    archived: boolean,
  ) {
    const operation = archived ? "archive" : "unarchive";
    const commandId = yield* lifecycleCommandId(operation, projectId);
    const fail = (cause: unknown) => new BotLifecycleError({ operation, projectId, cause });
    // Pause before hiding and show before resuming, so a failure never leaves a hidden bot running.
    if (archived) yield* routines.pauseForProject(projectId).pipe(Effect.mapError(fail));
    yield* projects.update({ commandId, projectId, archived }).pipe(Effect.mapError(fail));
    if (!archived) yield* routines.resumeForProject(projectId).pipe(Effect.mapError(fail));
  });

  // Descendants too, so a grandchild does not keep running under an archived bot.
  const liveDescendants = Effect.fn("Bots.liveDescendants")(function* (projectId: ProjectId) {
    const found: Array<ProjectId> = [];
    const queue = [projectId];
    const seen = new Set(queue);
    while (queue.length > 0) {
      const children = yield* childrenOf(queue.shift()!).pipe(
        Effect.mapError((cause) => new BotLifecycleError({ operation: "archive", projectId, cause })),
      );
      for (const child of children) {
        if (seen.has(child.id)) continue;
        seen.add(child.id);
        queue.push(child.id);
        if (child.archivedAt == null) found.push(child.id);
      }
    }
    return found;
  });

  const archive: Bots["Service"]["archive"] = Effect.fn("Bots.archive")(function* (input) {
    yield* readBot("archive", input.projectId);
    const projectIds = [
      input.projectId,
      ...(input.includeChildren === true ? yield* liveDescendants(input.projectId) : []),
    ];
    yield* Effect.forEach(projectIds, (projectId) => setArchived(projectId, true), {
      discard: true,
    });
    return { projectIds };
  });

  const unarchive: Bots["Service"]["unarchive"] = Effect.fn("Bots.unarchive")(function* (input) {
    yield* readBot("unarchive", input.projectId);
    yield* setArchived(input.projectId, false);
  });

  const isInsidePocks = Effect.fn("Bots.isInsidePocks")(function* (folder: string) {
    const root = path.join(yield* HostProcess.HomeDirectory, "pocks");
    const relative = path.relative(root, folder);
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
  });

  const deleteBot: Bots["Service"]["delete"] = Effect.fn("Bots.delete")(function* (input) {
    const { projectId } = input;
    const project = yield* readBot("delete", projectId);
    const folder = project.workspaceRoot;
    // Refuse before removing anything, so a folder outside ~/pocks never half-deletes the bot.
    if (input.removeHomeFolder === true && !(yield* isInsidePocks(folder))) {
      return yield* new BotFolderNotRemovableError({ folder });
    }
    const fail = (cause: unknown) =>
      new BotLifecycleError({ operation: "delete", projectId, cause });
    const commandId = yield* lifecycleCommandId("delete", projectId);
    yield* routines.deleteForProject(projectId).pipe(Effect.mapError(fail));
    yield* projects.delete({ commandId, projectId, force: true }).pipe(Effect.mapError(fail));
    if (input.removeHomeFolder === true) {
      yield* fileSystem
        .remove(folder, { recursive: true })
        .pipe(
          Effect.mapError((cause) => new BotHomeFolderError({ folder, action: "remove", cause })),
        );
    }
  });

  return Bots.of({
    create,
    createChild,
    childrenOf,
    readChild,
    messageChild,
    reportToParent,
    archive,
    unarchive,
    delete: deleteBot,
  });
});

export const layer = Layer.effect(Bots, make);
