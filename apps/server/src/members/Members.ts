/**
 * Members: people the owner invited to chat with some of their bots through Boops Connect. Each
 * member chats in their own threads, stamped with a member `linkOrigin`; see
 * `docs/internals/members.md`.
 */
import {
  botMainThreadId,
  CommandId,
  DEFAULT_MEMBER_ACCESS,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  type EnvironmentMember,
  EnvironmentMemberId,
  memberIdFromSessionSubject,
  MembersError,
  type MembersInviteInput,
  type MembersSetBotAccessInput,
  type MembersSetBotConnectionAccessInput,
  type MembersSnapshot,
  type MembersUpdateInput,
  memberSessionSubject,
  type OrchestrationV2LinkOrigin,
  type Project,
  type ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import * as SessionStore from "../auth/SessionStore.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { readRelayConnection } from "../cloud/config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as NotificationDeviceKeys from "../notifications/NotificationDeviceKeys.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as EnvironmentMembers from "../persistence/EnvironmentMembers.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { makeRelayEnvironmentClient } from "../relay/relayEnvironmentClient.ts";
import { isSharedWithMember, narrowToMemberAccess } from "./memberFence.ts";

/** The member a thread belongs to; undefined for the owner's own work. */
const threadMemberId = (thread: { readonly linkOrigin?: OrchestrationV2LinkOrigin | undefined }) =>
  thread.linkOrigin?.memberId;

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const toMember = (record: EnvironmentMembers.EnvironmentMemberRecord): EnvironmentMember => ({
  id: record.id,
  label: record.label,
  email: record.email,
  access: record.access,
  canCreateRooms: record.canCreateRooms,
  status: record.cloudUserId === null ? "invited" : "active",
  createdAt: record.createdAt,
  lastConnectedAt: record.lastConnectedAt,
});

const persistence = (cause: unknown) => new MembersError({ reason: "persistence", cause });

export class Members extends Context.Service<
  Members,
  {
    readonly list: Effect.Effect<MembersSnapshot, MembersError>;
    /** The members now, then again after every change. */
    readonly subscribe: Stream.Stream<MembersSnapshot, MembersError>;
    readonly get: (
      memberId: EnvironmentMemberId,
    ) => Effect.Effect<Option.Option<EnvironmentMember>, MembersError>;
    /** Records the member, invites their email through Boops Connect, then shares `projectIds`. */
    readonly invite: (input: MembersInviteInput) => Effect.Effect<EnvironmentMember, MembersError>;
    /** Access applies to conversations started after the change; stamped threads keep theirs. */
    readonly update: (input: MembersUpdateInput) => Effect.Effect<EnvironmentMember, MembersError>;
    /**
     * Deletes the member, signs out their devices, forgets their notification keys, withdraws
     * their Connect link, unshares every bot and stops and archives their threads.
     */
    readonly remove: (memberId: EnvironmentMemberId) => Effect.Effect<void, MembersError>;
    /** `remove`, for the member's own session. */
    readonly leave: (sessionSubject: string) => Effect.Effect<void, MembersError>;
    /** Turning a bot on also gives the member a conversation with it, unless they have one. */
    readonly setBotAccess: (input: MembersSetBotAccessInput) => Effect.Effect<void, MembersError>;
    readonly setBotConnectionAccess: (
      input: MembersSetBotConnectionAccessInput,
    ) => Effect.Effect<void, MembersError>;
    /**
     * At Connect mint: binds the Connect user on the member's first connection and records it.
     * None when the member is gone or bound to another user, so the mint is refused.
     */
    readonly authorizeMint: (input: {
      readonly cloudUserId: string;
      readonly memberId: string;
    }) => Effect.Effect<Option.Option<EnvironmentMember>, MembersError>;
  }
>()("boops/members/Members") {}

const make = Effect.gen(function* () {
  const store = yield* EnvironmentMembers.EnvironmentMemberRepository;
  const sessions = yield* SessionStore.SessionStore;
  const projects = yield* ProjectService.ProjectService;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const random = yield* SecureRandom.SecureRandom;
  const deviceKeys = yield* NotificationDeviceKeys.NotificationDeviceKeys;

  const changes = yield* PubSub.unbounded<void>();
  const published = PubSub.publish(changes, undefined).pipe(Effect.asVoid);
  const projectLocks = yield* KeyedLock.make<string>();
  const memberLocks = yield* KeyedLock.make<string>();

  const relayConnection = readRelayConnection.pipe(
    Effect.provideService(ServerSecretStore.ServerSecretStore, secrets),
  );
  const uuid = random.uuidV4().pipe(Effect.mapError(persistence));

  const relayClient = Effect.gen(function* () {
    const connection = yield* relayConnection;
    if (connection === null) return yield* new MembersError({ reason: "connect-required" });
    const client = yield* makeRelayEnvironmentClient(connection);
    return { client, environmentId: yield* environment.getEnvironmentId };
  });

  const list: Members["Service"]["list"] = Effect.all([store.list, relayConnection]).pipe(
    Effect.mapError(persistence),
    Effect.map(([records, connection]) => ({
      members: records.map(toMember),
      canInvite: connection !== null,
    })),
    Effect.withSpan("Members.list"),
  );

  const requireRecord = (memberId: EnvironmentMemberId) =>
    store.getById(memberId).pipe(
      Effect.mapError(persistence),
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(new MembersError({ reason: "not-found" })),
          onSome: Effect.succeed,
        }),
      ),
    );

  const requireBot = Effect.fn("Members.requireBot")(function* (projectId: ProjectId) {
    const project = yield* projects.getById(projectId).pipe(Effect.mapError(persistence));
    // Every project in Boops is a bot; older ones just have no recorded main thread.
    if (Option.isNone(project) || project.value.deletedAt !== null) {
      return yield* new MembersError({ reason: "not-a-bot" });
    }
    return project.value;
  });

  const updateBotMembers = (
    projectId: ProjectId,
    change: (ids: ReadonlyArray<EnvironmentMemberId>) => ReadonlyArray<EnvironmentMemberId>,
  ) =>
    projectLocks.withLock(
      projectId,
      Effect.gen(function* () {
        const project = yield* projects.getById(projectId).pipe(Effect.mapError(persistence));
        if (Option.isNone(project)) return;
        const current = project.value.memberIds ?? [];
        const next = change(current);
        if (next.length === current.length && next.every((id, index) => id === current[index])) {
          return;
        }
        const suffix = yield* uuid;
        yield* projects
          .update({
            commandId: CommandId.make(`members:bot:${projectId}:${suffix}`),
            projectId,
            memberIds: next,
          })
          .pipe(Effect.mapError(persistence));
      }),
    );

  /** The member's conversation with the bot, titled like the bot, at most at their access. */
  const ensureConversation = Effect.fn("Members.ensureConversation")(function* (
    bot: Project,
    member: EnvironmentMembers.EnvironmentMemberRecord,
  ) {
    const existing = yield* threads
      .listProjectThreads({ projectId: bot.id, includeSubagents: false })
      .pipe(Effect.mapError(persistence));
    if (existing.some((thread) => threadMemberId(thread) === member.id)) return;
    const ownerConversationId = botMainThreadId(
      bot,
      existing.filter((thread) => threadMemberId(thread) === undefined),
    );
    const main =
      ownerConversationId === null
        ? null
        : yield* threads.getThreadShell(ownerConversationId).pipe(Effect.mapError(persistence));
    const modelSelection = main?.modelSelection ?? bot.defaultModelSelection;
    if (modelSelection === null) return yield* new MembersError({ reason: "not-a-bot" });
    const botMode = main?.runtimeMode ?? narrowToMemberAccess("full-access", member.access);
    const id = yield* uuid;
    yield* threads
      .dispatch({
        type: "thread.create",
        createdBy: "user",
        creationSource: "server",
        commandId: CommandId.make(`member-thread:${id}`),
        threadId: ThreadId.make(id),
        projectId: bot.id,
        title: bot.title,
        modelSelection,
        runtimeMode: narrowToMemberAccess(botMode, member.access),
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        branch: null,
        worktreePath: null,
        linkOrigin: {
          sessionId: memberSessionSubject(member.id),
          label: member.label,
          access: member.access,
          memberId: member.id,
        },
      })
      .pipe(Effect.mapError(persistence));
  });

  const setBotAccess: Members["Service"]["setBotAccess"] = Effect.fn("Members.setBotAccess")(
    function* (input) {
      if (!input.enabled) {
        return yield* updateBotMembers(input.projectId, (ids) =>
          ids.filter((id) => id !== input.memberId),
        );
      }
      const member = yield* requireRecord(input.memberId);
      const bot = yield* requireBot(input.projectId);
      yield* updateBotMembers(input.projectId, (ids) =>
        ids.includes(input.memberId) ? ids : [...ids, input.memberId],
      );
      yield* memberLocks.withLock(member.id, ensureConversation(bot, member));
    },
  );

  const setBotConnectionAccess: Members["Service"]["setBotConnectionAccess"] = Effect.fn(
    "Members.setBotConnectionAccess",
  )(function* (input) {
    yield* projectLocks.withLock(
      input.projectId,
      Effect.gen(function* () {
        const bot = yield* requireBot(input.projectId);
        if (input.enabled && !(bot.connectionIds ?? []).includes(input.connectionId)) {
          return yield* new MembersError({ reason: "connection-off" });
        }
        const current = bot.memberConnectionIds ?? [];
        const next = input.enabled
          ? current.includes(input.connectionId)
            ? current
            : [...current, input.connectionId]
          : current.filter((id) => id !== input.connectionId);
        if (next === current || next.length === current.length) return;
        yield* projects
          .update({
            commandId: CommandId.make(`members:connections:${input.projectId}:${yield* uuid}`),
            projectId: input.projectId,
            memberConnectionIds: next,
          })
          .pipe(Effect.mapError(persistence));
      }),
    );
  });

  const invite: Members["Service"]["invite"] = Effect.fn("Members.invite")(function* (input) {
    const email = normalizeEmail(input.email);
    const relay = yield* relayClient;
    if (Option.isSome(yield* store.getByEmail(email).pipe(Effect.mapError(persistence)))) {
      return yield* new MembersError({ reason: "already-member" });
    }
    yield* Effect.forEach(input.projectIds, requireBot, { discard: true });
    const record: EnvironmentMembers.EnvironmentMemberRecord = {
      id: EnvironmentMemberId.make(yield* uuid),
      label: input.label,
      email,
      access: input.access ?? DEFAULT_MEMBER_ACCESS,
      canCreateRooms: false,
      cloudUserId: null,
      createdAt: DateTime.formatIso(yield* DateTime.now),
      lastConnectedAt: null,
    };
    yield* store.insert(record).pipe(Effect.mapError(persistence));
    const descriptor = yield* environment.getDescriptor;
    yield* relay.client.server
      .putMemberInvite({
        params: { environmentId: relay.environmentId, memberId: record.id },
        payload: { email, memberLabel: record.label, environmentLabel: descriptor.label },
      })
      .pipe(
        Effect.mapError((cause) => new MembersError({ reason: "relay-unavailable", cause })),
        // An invite Connect never heard of could never be accepted; don't keep it.
        Effect.tapError(() => store.delete(record.id).pipe(Effect.ignore)),
      );
    yield* published;
    yield* Effect.forEach(
      input.projectIds,
      (projectId) => setBotAccess({ projectId, memberId: record.id, enabled: true }),
      { discard: true },
    );
    return toMember(record);
  });

  const update: Members["Service"]["update"] = Effect.fn("Members.update")(function* (input) {
    const record = yield* store
      .update({
        id: input.memberId,
        label: input.label ?? null,
        access: input.access ?? null,
        canCreateRooms: input.canCreateRooms ?? null,
      })
      .pipe(Effect.mapError(persistence));
    if (Option.isNone(record)) return yield* new MembersError({ reason: "not-found" });
    yield* published;
    return toMember(record.value);
  });

  // Each step is best effort past the delete: the member can no longer mint or authorize.
  const stopThreads = Effect.fn("Members.stopThreads")(function* (memberId: EnvironmentMemberId) {
    const all = yield* threads
      .listProjectThreads({ includeSubagents: true })
      .pipe(Effect.mapError(persistence));
    for (const thread of all) {
      if (threadMemberId(thread) !== memberId) continue;
      const suffix = yield* uuid;
      yield* threads
        .interruptThread({
          projectId: thread.projectId,
          threadId: thread.id,
          commandId: CommandId.make(`member-removed:interrupt:${suffix}`),
          reason: "The member was removed.",
        })
        .pipe(Effect.ignore);
      yield* threads
        .dispatch({
          type: "thread.archive",
          commandId: CommandId.make(`member-removed:archive:${suffix}`),
          threadId: thread.id,
        })
        .pipe(
          Effect.catch((cause) =>
            Effect.logWarning("Could not archive a removed member's thread", {
              threadId: thread.id,
              cause,
            }),
          ),
        );
    }
  });

  const revokeSessions = (memberId: EnvironmentMemberId) =>
    sessions.revokeSubject(memberSessionSubject(memberId)).pipe(Effect.mapError(persistence));

  const removeMember = Effect.fn("Members.removeMember")(function* (
    memberId: EnvironmentMemberId,
    sessionsGo: "now" | "after-reply",
  ) {
    yield* requireRecord(memberId);
    yield* store.delete(memberId).pipe(Effect.mapError(persistence));
    yield* deviceKeys.removeMember(memberId).pipe(Effect.mapError(persistence));
    // Revoking closes the leaving member's own socket, which would swallow the reply to `leave`.
    if (sessionsGo === "now") yield* revokeSessions(memberId);
    else yield* Effect.forkDetach(revokeSessions(memberId).pipe(Effect.ignore));
    yield* published;
    yield* relayClient.pipe(
      Effect.flatMap(({ client, environmentId }) =>
        client.server.removeMember({ params: { environmentId, memberId } }),
      ),
      Effect.catch((cause) =>
        Effect.logWarning("Could not withdraw a removed member from Boops Connect", { cause }),
      ),
    );
    const shells = yield* projects.listShells().pipe(Effect.mapError(persistence));
    yield* Effect.forEach(
      shells.filter((shell) => isSharedWithMember(shell, memberId)),
      (shell) => updateBotMembers(shell.id, (ids) => ids.filter((id) => id !== memberId)),
      { discard: true },
    );
    yield* stopThreads(memberId);
  });

  const remove: Members["Service"]["remove"] = (memberId) => removeMember(memberId, "now");

  const leave: Members["Service"]["leave"] = (sessionSubject) => {
    const memberId = memberIdFromSessionSubject(sessionSubject);
    return memberId === undefined
      ? Effect.fail(new MembersError({ reason: "not-found" }))
      : removeMember(memberId, "after-reply");
  };

  const authorizeMint: Members["Service"]["authorizeMint"] = Effect.fn("Members.authorizeMint")(
    function* (input) {
      const record = yield* store
        .bindCloudUser({
          id: EnvironmentMemberId.make(input.memberId),
          cloudUserId: input.cloudUserId,
          connectedAt: DateTime.formatIso(yield* DateTime.now),
        })
        .pipe(Effect.mapError(persistence));
      if (Option.isNone(record)) return Option.none();
      yield* published;
      return Option.some(toMember(record.value));
    },
  );

  const get: Members["Service"]["get"] = (memberId) =>
    store.getById(memberId).pipe(Effect.mapError(persistence), Effect.map(Option.map(toMember)));

  const subscribe: Members["Service"]["subscribe"] = Stream.unwrap(
    Effect.gen(function* () {
      // Subscribe before the first read so no change between them is missed.
      const signals = yield* PubSub.subscribe(changes);
      return Stream.concat(
        Stream.fromEffect(list),
        Stream.fromSubscription(signals).pipe(Stream.mapEffect(() => list)),
      );
    }),
  );

  return Members.of({
    list,
    subscribe,
    get,
    invite,
    update,
    remove,
    leave,
    setBotAccess,
    setBotConnectionAccess,
    authorizeMint,
  });
});

export const layer = Layer.effect(Members, make).pipe(
  Layer.provideMerge(EnvironmentMembers.layer),
  Layer.provideMerge(NotificationDeviceKeys.layer),
);
