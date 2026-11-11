import {
  type AuthEnvironmentScope,
  authScopeRequiredResponse,
  AuthOrchestrationOperateScope,
  DEFAULT_MEMBER_ACCESS,
  EnvironmentAuthorizationError,
  EnvironmentMemberId,
  isListedThreadLineage,
  isRuntimeModeAbove,
  type MemberAccess,
  type OrchestrationProjectShell,
  type OrchestrationV2Command,
  type OrchestrationV2LinkOrigin,
  type OrchestrationV2ShellSnapshot,
  type OrchestrationV2ShellStreamItem,
  type OrchestrationV2ThreadLaunchWorkspaceStrategy,
  type OrchestrationV2ThreadShell,
  ProjectId,
  type RuntimeMode,
  type ServerConfig,
  type ServerConfigStreamEvent,
  type ServerLifecycleStreamEvent,
  type ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";

/**
 * What an invited member may see and do here. The owner (`viewer` undefined) sees every thread no
 * member started; a member sees only her own threads, in bots shared with her. Reads are fenced
 * too, unlike a peer link's. See `docs/internals/members.md`.
 */

export const memberDenied = (requiredScope: AuthEnvironmentScope = AuthOrchestrationOperateScope) =>
  new EnvironmentAuthorizationError({
    message: "Only the owner of this environment can do that.",
    ...authScopeRequiredResponse(requiredScope),
  });

/** A member's turns never run above her access; `read-only` still chats, asking first. */
export const narrowToMemberAccess = (
  mode: RuntimeMode,
  access: MemberAccess | undefined,
): RuntimeMode => {
  const granted = access ?? DEFAULT_MEMBER_ACCESS;
  const ceiling = granted === "read-only" ? "approval-required" : granted;
  return isRuntimeModeAbove(mode, ceiling) ? ceiling : mode;
};

export const isSharedWithMember = (
  project: Pick<OrchestrationProjectShell, "memberIds">,
  memberId: EnvironmentMemberId,
) => project.memberIds?.includes(memberId) === true;

type ThreadOrigin = Pick<OrchestrationV2ThreadShell, "linkOrigin">;

export const isThreadVisibleTo = (viewer: EnvironmentMemberId | undefined, thread: ThreadOrigin) =>
  thread.linkOrigin?.memberId === viewer;

export interface MemberThreadRow {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly memberId: EnvironmentMemberId;
  readonly createdAtMs: number;
  readonly archived: boolean;
  readonly listed: boolean;
}

/** Every live thread a member started; the owner's threads are the rest. */
export const readMemberThreads = Effect.fn("memberFence.readMemberThreads")(function* (
  sql: SqlClient.SqlClient,
) {
  const rows = yield* sql<{
    readonly thread_id: string;
    readonly project_id: string;
    readonly member_id: string;
    readonly created_at: string;
    readonly archived: number;
    readonly listed: number;
  }>`
    SELECT
      thread_id,
      project_id,
      json_extract(payload_json, '$.linkOrigin.memberId') AS member_id,
      created_at,
      json_extract(payload_json, '$.archivedAt') IS NOT NULL AS archived,
      (
        COALESCE(json_extract(payload_json, '$.lineage.relationshipToParent'), '') != 'subagent'
        AND COALESCE(json_extract(payload_json, '$.lineage.sideChat'), 0) = 0
      ) AS listed
    FROM orchestration_v2_projection_threads
    WHERE deleted_at IS NULL
      AND json_extract(payload_json, '$.linkOrigin.memberId') IS NOT NULL
  `;
  return rows.map((row): MemberThreadRow => ({
    threadId: ThreadId.make(row.thread_id),
    projectId: ProjectId.make(row.project_id),
    memberId: EnvironmentMemberId.make(row.member_id),
    createdAtMs: Date.parse(row.created_at),
    archived: row.archived === 1,
    listed: row.listed === 1,
  }));
});

interface Conversation {
  readonly projectId: ProjectId;
  readonly createdAtMs: number;
  readonly open: boolean;
}

type ShellItem = OrchestrationV2ShellStreamItem;

/**
 * One shell subscriber's view. It learns who started each thread from `readMemberThreads` and the
 * events it sees, so events for threads the viewer cannot see are dropped before their shells are
 * read. A member's shared bots point `mainThreadId` at her oldest open conversation in them.
 */
export const makeShellAudience = (
  viewer: EnvironmentMemberId | undefined,
  rows: ReadonlyArray<MemberThreadRow>,
) => {
  const startedBy = new Map<ThreadId, EnvironmentMemberId>();
  const conversations = new Map<ThreadId, Conversation>();
  const projects = new Map<ProjectId, OrchestrationProjectShell>();
  const sentMainThreads = new Map<ProjectId, ThreadId | null>();
  for (const row of rows) {
    startedBy.set(row.threadId, row.memberId);
    if (row.memberId === viewer && row.listed) {
      conversations.set(row.threadId, {
        projectId: row.projectId,
        createdAtMs: row.createdAtMs,
        open: !row.archived,
      });
    }
  }

  const learn = (threadId: ThreadId, memberId: EnvironmentMemberId | undefined) => {
    if (memberId !== undefined) startedBy.set(threadId, memberId);
  };

  const observe = (shell: OrchestrationV2ThreadShell) => {
    learn(shell.id, shell.linkOrigin?.memberId);
    if (viewer === undefined || !isThreadVisibleTo(viewer, shell)) return;
    if (!isListedThreadLineage(shell.lineage)) return;
    conversations.set(shell.id, {
      projectId: shell.projectId,
      createdAtMs: DateTime.toEpochMillis(shell.createdAt),
      open: shell.archivedAt === null,
    });
  };

  const mainThreadId = (projectId: ProjectId): ThreadId | null => {
    let main: { readonly id: ThreadId; readonly createdAtMs: number } | undefined;
    for (const [id, conversation] of conversations) {
      if (conversation.projectId !== projectId || !conversation.open) continue;
      if (
        main === undefined ||
        conversation.createdAtMs < main.createdAtMs ||
        (conversation.createdAtMs === main.createdAtMs && id < main.id)
      ) {
        main = { id, createdAtMs: conversation.createdAtMs };
      }
    }
    return main?.id ?? null;
  };

  /** The project as the viewer sees it, or undefined when it is not shared with her. */
  const viewProject = (project: OrchestrationProjectShell) => {
    projects.set(project.id, project);
    if (viewer === undefined) return project;
    if (!isSharedWithMember(project, viewer)) return undefined;
    const main = mainThreadId(project.id);
    sentMainThreads.set(project.id, main);
    return { ...project, memberIds: [viewer], mainThreadId: main };
  };

  const isShared = (projectId: ProjectId) => {
    const project = projects.get(projectId);
    return viewer === undefined || (project !== undefined && isSharedWithMember(project, viewer));
  };

  const isVisible = (shell: OrchestrationV2ThreadShell) =>
    isThreadVisibleTo(viewer, shell) && isShared(shell.projectId);

  /** Shared bots whose main conversation moved since the viewer last saw them. */
  const movedMainThreads = (sequence: number): ReadonlyArray<ShellItem> => {
    if (viewer === undefined) return [];
    const moved: Array<ShellItem> = [];
    for (const [projectId, sent] of sentMainThreads) {
      const project = projects.get(projectId);
      if (project === undefined || mainThreadId(projectId) === sent) continue;
      const viewed = viewProject(project);
      if (viewed !== undefined) moved.push({ kind: "project.updated", sequence, project: viewed });
    }
    return moved;
  };

  const viewSnapshot = (snapshot: OrchestrationV2ShellSnapshot): OrchestrationV2ShellSnapshot => {
    for (const thread of snapshot.threads) observe(thread);
    for (const thread of snapshot.archivedThreads) observe(thread);
    const visibleProjects = snapshot.projects.flatMap((project) => viewProject(project) ?? []);
    const olderSettled = snapshot.olderSettled;
    return {
      ...snapshot,
      projects: visibleProjects,
      threads: snapshot.threads.filter(isVisible),
      archivedThreads: snapshot.archivedThreads.filter(isVisible),
      ...(olderSettled === undefined
        ? {}
        : {
            olderSettled: {
              ...olderSettled,
              counts: olderSettled.counts.filter((count) => isShared(count.projectId)),
            },
          }),
    };
  };

  const viewItem = (item: ShellItem): ReadonlyArray<ShellItem> => {
    switch (item.kind) {
      case "synchronized":
        return [item];
      case "snapshot": {
        const snapshot = viewSnapshot(item.snapshot);
        const roots = item.resolvedRepositoryIdentityRoots;
        if (roots === undefined || viewer === undefined) return [{ ...item, snapshot }];
        const visibleRoots = new Set(snapshot.projects.map((project) => project.workspaceRoot));
        return [
          {
            ...item,
            snapshot,
            resolvedRepositoryIdentityRoots: roots.filter((root) => visibleRoots.has(root)),
          },
        ];
      }
      case "project.updated": {
        const wasShared = isShared(item.project.id);
        const viewed = viewProject(item.project);
        if (viewed !== undefined) return [{ ...item, project: viewed }];
        sentMainThreads.delete(item.project.id);
        if (!wasShared) return [];
        // Unsharing a bot takes it, and her conversations in it, out of her live shell.
        return [
          ...Array.from(conversations, ([threadId, conversation]) =>
            conversation.projectId === item.project.id
              ? [
                  {
                    kind: "thread.removed" as const,
                    sequence: item.sequence,
                    location: "active" as const,
                    threadId,
                  },
                ]
              : [],
          ).flat(),
          { kind: "project.removed", sequence: item.sequence, projectId: item.project.id },
        ];
      }
      case "project.removed": {
        const visible = isShared(item.projectId);
        projects.delete(item.projectId);
        sentMainThreads.delete(item.projectId);
        return visible ? [item] : [];
      }
      case "thread.updated": {
        observe(item.thread);
        if (!isVisible(item.thread)) return [];
        return [item, ...movedMainThreads(item.sequence)];
      }
      case "thread.removed": {
        const visible = startedBy.get(item.threadId) === viewer;
        const conversation = conversations.get(item.threadId);
        if (conversation !== undefined) {
          conversations.set(item.threadId, { ...conversation, open: false });
        }
        if (!visible) return [];
        return [item, ...movedMainThreads(item.sequence)];
      }
    }
  };

  return {
    /** Whether a thread's shell is worth reading for this viewer at all. */
    mayRead: (threadId: ThreadId) => startedBy.get(threadId) === viewer,
    learn,
    isShared,
    isVisible,
    viewProject,
    viewSnapshot,
    viewItem,
  };
};

type CommandThread = Pick<
  OrchestrationV2ThreadShell,
  "projectId" | "providerInstanceId" | "linkOrigin" | "deletedAt"
>;

export interface MemberContext<E> {
  readonly memberId: EnvironmentMemberId;
  readonly threadShell: (threadId: ThreadId) => Effect.Effect<CommandThread | null, E>;
  readonly project: (
    projectId: ProjectId,
  ) => Effect.Effect<Pick<OrchestrationProjectShell, "memberIds"> | undefined, E>;
  /** The stamp her new threads carry; undefined once she is no longer a member. */
  readonly origin: Effect.Effect<OrchestrationV2LinkOrigin | undefined, E>;
}

export const requireOwnThread = <E>(context: MemberContext<E>, threadId: ThreadId) =>
  context.threadShell(threadId).pipe(
    Effect.filterOrFail(
      (thread): thread is CommandThread =>
        thread !== null && thread.deletedAt === null && isThreadVisibleTo(context.memberId, thread),
      () => memberDenied(),
    ),
  );

/** Uploads ahead of a launch name a thread that does not exist yet. */
export const requireOwnOrNewThread = <E>(context: MemberContext<E>, threadId: ThreadId) =>
  context
    .threadShell(threadId)
    .pipe(
      Effect.flatMap((thread) =>
        thread === null || isThreadVisibleTo(context.memberId, thread)
          ? Effect.void
          : Effect.fail(memberDenied()),
      ),
    );

/** Her stamp for a new thread in a bot shared with her. */
const originForNewThread = Effect.fnUntraced(function* <E>(
  context: MemberContext<E>,
  projectId: ProjectId,
) {
  const project = yield* context.project(projectId);
  const origin = yield* context.origin;
  if (
    project === undefined ||
    origin === undefined ||
    !isSharedWithMember(project, context.memberId)
  ) {
    return yield* memberDenied();
  }
  return origin;
});

/**
 * A member's launch: a new conversation at the bot's root, never a worktree, or her own existing
 * thread. The server stamps it as hers and narrows its mode to her access.
 */
export const authorizeMemberLaunch = Effect.fn("memberFence.authorizeMemberLaunch")(function* <E>(
  context: MemberContext<E>,
  input: {
    readonly projectId: ProjectId;
    readonly threadId?: ThreadId | undefined;
    readonly runtimeMode: RuntimeMode;
    readonly workspaceStrategy: OrchestrationV2ThreadLaunchWorkspaceStrategy;
  },
) {
  if (input.workspaceStrategy.type !== "root" || input.workspaceStrategy.branch !== undefined) {
    return yield* memberDenied();
  }
  if (input.threadId !== undefined) {
    const existing = yield* context.threadShell(input.threadId);
    if (existing !== null && !isThreadVisibleTo(context.memberId, existing)) {
      return yield* memberDenied();
    }
  }
  const linkOrigin = yield* originForNewThread(context, input.projectId);
  return {
    linkOrigin,
    runtimeMode: narrowToMemberAccess(input.runtimeMode, linkOrigin.access),
  };
});

/**
 * Chat on her own threads, and new threads in bots shared with her; nothing else. Runs after
 * `withCreationProvenance`, so a `thread.create` reaches here without a client's `linkOrigin`.
 */
export const authorizeMemberCommand = Effect.fn("memberFence.authorizeMemberCommand")(function* <E>(
  context: MemberContext<E>,
  command: OrchestrationV2Command,
) {
  switch (command.type) {
    case "thread.create": {
      if (
        command.branch !== null ||
        command.worktreePath !== null ||
        command.importedNativeThread !== undefined
      ) {
        return yield* memberDenied();
      }
      const linkOrigin = yield* originForNewThread(context, command.projectId);
      return {
        ...command,
        linkOrigin,
        runtimeMode: narrowToMemberAccess(command.runtimeMode, linkOrigin.access),
      } satisfies OrchestrationV2Command;
    }
    case "message.dispatch": {
      if (
        command.guestMessageId !== undefined ||
        command.senderThreadId !== undefined ||
        command.delegatedCompletion !== undefined ||
        (command.dispatchMode.type === "defer_start" &&
          command.dispatchMode.workspaceStrategy !== undefined)
      ) {
        return yield* memberDenied();
      }
      const thread = yield* requireOwnThread(context, command.threadId);
      // Another model is fine; another provider is a provider switch.
      if (
        command.modelSelection !== undefined &&
        command.modelSelection.instanceId !== thread.providerInstanceId
      ) {
        return yield* memberDenied();
      }
      return command;
    }
    case "thread.metadata.update": {
      if (
        command.branch !== undefined ||
        command.worktreePath !== undefined ||
        command.expectedWorktreePath !== undefined ||
        command.expectedBranch !== undefined ||
        command.limitRecovery !== undefined ||
        command.linkedPullRequest !== undefined
      ) {
        return yield* memberDenied();
      }
      yield* requireOwnThread(context, command.threadId);
      return command;
    }
    case "message.edit":
    case "message.reaction.set":
    case "thread.stop":
    case "run.interrupt":
    case "thread.visit":
    case "thread.mark-unread":
    case "thread.archive":
    case "thread.unarchive":
    case "runtime-request.respond":
    case "thread.user-input.dismiss": {
      yield* requireOwnThread(context, command.threadId);
      return command;
    }
    default:
      return yield* memberDenied();
  }
});

const HIDDEN_PATH = "~";

/** Which providers can chat, without the owner's accounts, usage or paths. */
const memberProvider = ({
  runtimePaths: _runtimePaths,
  workspaceSnapshots: _workspaceSnapshots,
  usageLimits: _usageLimits,
  auth,
  ...provider
}: ServerProvider): ServerProvider => ({ ...provider, auth: { status: auth.status } });

/** The config a member's chat needs; host paths, addresses and accounts stay with the owner. */
export const redactServerConfigForMember = ({
  directEndpoints: _directEndpoints,
  remoteOpenTargets: _remoteOpenTargets,
  scratchWorkspaceRoot: _scratchWorkspaceRoot,
  newProjectsRoot: _newProjectsRoot,
  ...config
}: ServerConfig): ServerConfig => ({
  ...config,
  cwd: HIDDEN_PATH,
  keybindingsConfigPath: HIDDEN_PATH,
  availableEditors: [],
  providers: config.providers.map(memberProvider),
  observability: {
    logsDirectoryPath: HIDDEN_PATH,
    localTracingEnabled: false,
    otlpTracesEnabled: false,
    otlpMetricsEnabled: false,
    otlpLogsEnabled: false,
  },
});

export const redactServerConfigEventForMember = (
  event: ServerConfigStreamEvent,
): ServerConfigStreamEvent => {
  switch (event.type) {
    case "snapshot":
      return { ...event, config: redactServerConfigForMember(event.config) };
    case "providerStatuses":
      return { ...event, payload: { providers: event.payload.providers.map(memberProvider) } };
    default:
      return event;
  }
};

/** The welcome names the host's folder and the owner's first thread; a member needs neither. */
export const redactServerLifecycleEventForMember = (
  event: ServerLifecycleStreamEvent,
): ServerLifecycleStreamEvent =>
  event.type === "welcome"
    ? {
        ...event,
        payload: {
          environment: event.payload.environment,
          cwd: HIDDEN_PATH,
          projectName: event.payload.projectName,
        },
      }
    : event;
