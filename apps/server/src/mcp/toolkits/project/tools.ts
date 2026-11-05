import { McpAttachmentInput } from "../attachment/input.ts";
import {
  NonNegativeInt,
  ModelSelection,
  TrimmedNonEmptyString,
  ThreadId,
  RunId,
  OrchestrationV2DelegatedFrom,
  OrchestrationV2RunStatus,
  OrchestrationV2ThreadLaunchWorkspaceStrategy,
  RuntimeMode,
  ProviderInteractionMode,
  Project,
  ProjectCreatePayload,
  ProjectUpdatePayload,
  ProjectId,
  OrchestratorMcpClientRequestId,
  OrchestratorMcpEnvironmentTarget,
  OrchestratorMcpFailure,
  SourceControlCloneRepositoryInput,
  SourceControlCloneRepositoryResult,
} from "@t3tools/contracts";
import * as FileSystem from "effect/FileSystem";
import * as DocumentText from "../../../provider/DocumentText.ts";
import * as ServerConfig from "../../../config.ts";
import * as ProviderRegistry from "../../../provider/ProviderRegistry.ts";
import * as ServerSettings from "../../../serverSettings.ts";
import * as ThreadLaunchService from "../../../orchestration-v2/ThreadLaunchService.ts";
import * as Digest from "effect/crypto/Digest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";
import * as Bots from "../../../bots/Bots.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as ManagedProjectFolders from "../../../project/ManagedProjectFolders.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as SourceControlRepositoryService from "../../../sourceControl/SourceControlRepositoryService.ts";
import * as GitVcsDriver from "../../../vcs/GitVcsDriver.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  success: Project,
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ProjectService.ProjectService,
    SecureRandom.SecureRandom,
  ],
};
const ProjectListTool = Tool.make("t3_project_list", {
  ...shared,
  description: "List projects. Pages can shift.",
  parameters: Schema.Struct({
    environmentId: OrchestratorMcpEnvironmentTarget,
    cursor: Schema.optional(NonNegativeInt),
    limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
  }),
  success: Schema.Struct({
    projects: Schema.Array(Project),
    nextCursor: Schema.NullOr(NonNegativeInt),
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);
const ProjectReadTool = Tool.make("t3_project_read", {
  ...shared,
  description: "Read one project: workspace and saved scripts.",
  parameters: Schema.Struct({
    environmentId: OrchestratorMcpEnvironmentTarget,
    projectId: ProjectId,
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);
const ProjectCreateTool = Tool.make("t3_project_create", {
  ...shared,
  description:
    "Register a project folder. `createWorkspaceRootIfMissing` creates it; a registered folder is rejected. No `workspaceRoot`: makes a git repo from `title` with README, icon, first commit (`commitError` on failure; project still exists). Clone first with `t3_project_clone` if needed.",
  parameters: Schema.Struct({
    environmentId: OrchestratorMcpEnvironmentTarget,
    ...ProjectCreatePayload.fields,
    workspaceRoot: Schema.optional(ProjectCreatePayload.fields.workspaceRoot),
  }),
  success: Schema.Struct({ ...Project.fields, commitError: Schema.optional(Schema.String) }),
  dependencies: [...shared.dependencies, ManagedProjectFolders.ManagedProjectFolders],
}).annotate(Tool.Destructive, true);
// Bot identity is set from the clients until agents get an approval gate for it. Autonomy and
// the bot family fields stay client-only for good: a bot must not lift its own limits.
// Archiving goes through t3_bot_archive, which pauses routines and asks the user first.
const {
  avatar: _avatar,
  mainThreadId: _mainThreadId,
  autonomy: _autonomy,
  parentBotProjectId: _parentBotProjectId,
  canCreateBotsWithoutAsking: _canCreateBotsWithoutAsking,
  archived: _archived,
  ...projectUpdateFields
} = ProjectUpdatePayload.fields;
const ProjectUpdateTool = Tool.make("t3_project_update", {
  ...shared,
  description: "Update one project's settings. Omitted fields are unchanged.",
  parameters: Schema.Struct({
    environmentId: OrchestratorMcpEnvironmentTarget,
    projectId: ProjectId,
    ...projectUpdateFields,
  }),
}).annotate(Tool.Destructive, true);
const BotArchiveTool = Tool.make("t3_bot_archive", {
  ...shared,
  description:
    "Ask the user to archive a bot: you, or one you created. They approve or decline on a card. Archiving pauses its routines and hides it; its conversation and folder stay. Bots cannot delete bots.",
  parameters: Schema.Struct({
    projectId: Schema.optional(
      ProjectId.annotate({ description: "The bot's project. Omit for yourself." }),
    ),
    includeChildren: Schema.optional(
      Schema.Boolean.annotate({ description: "Also archive the bots it created." }),
    ),
    reason: TrimmedNonEmptyString.check(Schema.isMaxLength(500)).annotate({
      description: "Why, shown on the card.",
    }),
  }),
  success: Schema.Struct({
    status: Schema.Literals(["archived", "declined"]),
    projectIds: Schema.Array(ProjectId),
  }),
  dependencies: [...shared.dependencies, Bots.Bots],
})
  .annotate(Tool.Title, "Suggest archiving a bot")
  .annotate(Tool.Destructive, false);
// Unarchive and delete are the user's: outside MCP clients see them, bots never do.
const BotUnarchiveTool = Tool.make("t3_bot_unarchive", {
  ...shared,
  description: "Unarchive a bot and resume the routines archiving paused.",
  parameters: Schema.Struct({ projectId: ProjectId }),
  success: Schema.Struct({ projectId: ProjectId }),
  dependencies: [...shared.dependencies, Bots.Bots],
})
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromThreads);
const BotDeleteTool = Tool.make("t3_bot_delete", {
  ...shared,
  description:
    "Delete a bot's routines, threads and project. `removeHomeFolder` also deletes its ~/pocks folder. Permanent.",
  parameters: Schema.Struct({
    projectId: ProjectId,
    removeHomeFolder: Schema.optional(Schema.Boolean),
  }),
  success: Schema.Struct({ projectId: ProjectId }),
  dependencies: [...shared.dependencies, Bots.Bots],
})
  .annotate(Tool.Destructive, true)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromThreads);
const ProjectCloneTool = Tool.make("t3_project_clone", {
  ...shared,
  description:
    "Clone a repository (`destinationPath` new or empty). Register after with `t3_project_create`, with the same `environmentId`.",
  parameters: Schema.Struct({
    environmentId: OrchestratorMcpEnvironmentTarget,
    ...SourceControlCloneRepositoryInput.fields,
  }),
  success: SourceControlCloneRepositoryResult,
  dependencies: [
    ...shared.dependencies,
    SourceControlRepositoryService.SourceControlRepositoryService,
  ],
})
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, true);
const ThreadLaunchTool = Tool.make("t3_thread_launch", {
  ...shared,
  description:
    "Create one new top-level thread, bound to its workspace before the agent starts. Task in `message`. Omit `projectId`, model and modes to inherit yours (outside a thread, pass `projectId` or `scratch`); modes cannot exceed yours. After an error or lost reply, retry with the same `clientRequestId`. Follow it with `t3_thread_read` or `t3_thread_wait`. Mention it with its `link`.",
  parameters: Schema.Struct({
    environmentId: OrchestratorMcpEnvironmentTarget,
    projectId: Schema.optional(ProjectId),
    scratch: Schema.optional(
      Schema.Boolean.annotate({
        description:
          "No project: a new Scratch folder. Not with `projectId` or `workspaceStrategy`.",
      }),
    ),
    title: TrimmedNonEmptyString,
    modelSelection: Schema.optional(ModelSelection),
    runtimeMode: Schema.optional(RuntimeMode),
    interactionMode: Schema.optional(ProviderInteractionMode),
    workspaceStrategy: Schema.optional(
      OrchestrationV2ThreadLaunchWorkspaceStrategy.annotate({
        description:
          "'worktree': new checkout from `baseRef`. 'existing_worktree': bind `worktreePath`, a project worktree. 'root': project checkout, the default, not your worktree. Stack: parent branch as `baseRef`, `startFromOrigin: false`. Uncommitted edits are not copied.",
      }),
    ),
    message: Schema.optional(
      Schema.String.check(Schema.isMaxLength(120000)).annotate({
        description: "First prompt. Omit it and `attachments` for idle.",
      }),
    ),
    attachments: Schema.optional(Schema.Array(McpAttachmentInput).check(Schema.isMaxLength(8))),
    clientRequestId: Schema.optional(OrchestratorMcpClientRequestId),
    /** Set by a linked environment launching its agent's delegated task here; ignored otherwise. */
    delegatedFrom: Schema.optional(OrchestrationV2DelegatedFrom),
  }),
  success: Schema.Struct({
    threadId: ThreadId,
    link: Schema.optional(Schema.String),
    projectId: ProjectId,
    modelSelection: ModelSelection,
    runId: Schema.NullOr(RunId),
    status: Schema.NullOr(OrchestrationV2RunStatus),
  }),
  dependencies: [
    ...shared.dependencies,
    ThreadLaunchService.ThreadLaunchService,
    ManagedProjectFolders.ManagedProjectFolders,
    GitVcsDriver.GitVcsDriver,
    FileSystem.FileSystem,
    ServerConfig.ServerConfig,
    ServerSettings.ServerSettingsService,
    ProviderRegistry.ProviderRegistry,
    DocumentText.DocumentText,
    Digest.Digest,
  ],
})
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, true);

export const ProjectToolkit = Toolkit.make(
  ThreadLaunchTool,
  ProjectListTool,
  ProjectReadTool,
  ProjectCreateTool,
  ProjectUpdateTool,
  BotArchiveTool,
  BotUnarchiveTool,
  BotDeleteTool,
  ProjectCloneTool,
);
