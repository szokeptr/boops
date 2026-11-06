import * as Schema from "effect/Schema";

import {
  ConnectorConnectionId,
  IsoDateTime,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { RepositoryIdentity, ThreadEnvMode } from "./environment.ts";
import { EnvironmentMemberId } from "./members.ts";
import { ModelSelection } from "./modelSelection.ts";
import {
  BotAutonomy,
  ProjectScript,
  ReceivedProjectAvatar,
  ReceivedProjectIcon,
} from "./project.ts";

export const OrchestrationProjectShell = Schema.Struct({
  id: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.NullOr(ModelSelection),
  defaultThreadEnvMode: Schema.optional(Schema.NullOr(ThreadEnvMode)),
  // Opt-in because background sync performs network I/O and may move the checkout.
  autoPull: Schema.optional(Schema.Boolean),
  faviconPath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  projectIcon: Schema.optional(Schema.NullOr(ReceivedProjectIcon)),
  scripts: Schema.Array(ProjectScript),
  // Pinned projects lead project pickers; archived ones leave them. Optional so older servers decode.
  pinnedAt: Schema.optional(Schema.NullOr(IsoDateTime)),
  archivedAt: Schema.optional(Schema.NullOr(IsoDateTime)),
  // Bot identity; see botMainThreadId for the main-thread fallback.
  avatar: Schema.optional(ReceivedProjectAvatar),
  mainThreadId: Schema.optional(Schema.NullOr(ThreadId)),
  autonomy: Schema.optional(BotAutonomy),
  parentBotProjectId: Schema.optional(Schema.NullOr(ProjectId)),
  canCreateBotsWithoutAsking: Schema.optional(Schema.Boolean),
  /** Server-kept: the bot's home folder has a PERSONA.md, so it has hatched. Absent from older servers. */
  personaReady: Schema.optional(Schema.Boolean),
  /** Connections turned on for this bot; only the user turns them on, through `connectors.*`. */
  connectionIds: Schema.optional(Schema.Array(ConnectorConnectionId)),
  /** Members this bot is shared with; only the owner changes it, through `members.setBotAccess`. */
  memberIds: Schema.optional(Schema.Array(EnvironmentMemberId)),
  /** Which of `connectionIds` its members' conversations may use too; through `members.setBotConnectionAccess`. */
  memberConnectionIds: Schema.optional(Schema.Array(ConnectorConnectionId)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationProjectShell = typeof OrchestrationProjectShell.Type;
