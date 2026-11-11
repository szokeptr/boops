import * as PlatformNodeCrypto from "@effect/platform-node/NodeCrypto";
import {
  type ApplicationStoredEvent,
  botRoomThreadId,
  type ChatAttachment,
  ChatAttachmentId,
  type OrchestrationV2DomainEvent,
  type EnvironmentMember,
  EnvironmentMemberId,
  MessageId,
  type MembersSnapshot,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2ThreadShell,
  type Project,
  ProjectId,
  ProviderInstanceId,
  type RoomFeedItem,
  type RoomId,
  RoomMessageId,
  type RoomsError,
  type RoomsSnapshot,
  RunId,
  type RuntimeMode,
  ThreadId,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as Members from "../members/Members.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as OrchestrationEventStore from "../persistence/OrchestrationEventStore.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as AgentAwarenessRelay from "../relay/AgentAwarenessRelay.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as RoomAttachmentClaims from "./RoomAttachmentClaims.ts";
import * as RoomRouter from "./RoomRouter.ts";
import * as Rooms from "./Rooms.ts";

const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" };
const scoutId = ProjectId.make("project:scout");
const chefId = ProjectId.make("project:chef");
const anna = EnvironmentMemberId.make("anna");
const ben = EnvironmentMemberId.make("ben");
const owner: Rooms.RoomViewer = { kind: "owner" };
const asAnna: Rooms.RoomViewer = { kind: "member", memberId: anna };
const asBen: Rooms.RoomViewer = { kind: "member", memberId: ben };

const bot = (id: ProjectId, title: string, memberIds: ReadonlyArray<EnvironmentMemberId>) =>
  ({
    id,
    title,
    workspaceRoot: `/home/user/boops/${title}`,
    defaultModelSelection: modelSelection,
    scripts: [],
    mainThreadId: ThreadId.make(`main:${id}`),
    avatar: null,
    memberIds,
    createdAt: "2026-11-05T00:00:00.000Z",
    updatedAt: "2026-11-05T00:00:00.000Z",
    deletedAt: null,
  }) satisfies Project;

const member = (
  id: EnvironmentMemberId,
  label: string,
  canCreateRooms: boolean,
): EnvironmentMember => ({
  id,
  label,
  email: `${id}@example.com`,
  access: "read-only",
  canCreateRooms,
  status: "active",
  createdAt: "2026-11-05T00:00:00.000Z",
  lastConnectedAt: null,
});

const makeHarness = Effect.gen(function* () {
  const bots = new Map([
    [scoutId, bot(scoutId, "Scout", [anna])],
    [chefId, bot(chefId, "Chef", [])],
  ]);
  let members: MembersSnapshot = {
    members: [member(anna, "Anna", true), member(ben, "Ben", false)],
    canInvite: true,
  };
  const memberChanges = yield* Queue.unbounded<MembersSnapshot>();
  const threads = new Map<ThreadId, { projectId: ProjectId; runtimeMode: RuntimeMode }>();
  const sent: Array<{
    threadId: ThreadId;
    text: string;
    runId: RunId;
    attachments: ReadonlyArray<ChatAttachment>;
  }> = [];
  const replies = new Map<ThreadId, Array<OrchestrationV2ConversationMessage>>();
  const waiting = new Map<ThreadId, { runtimeRequests: unknown[]; turnItems: unknown[] }>();
  const responded: Array<{ threadId: ThreadId; requestId: string }> = [];
  const dispatched: Array<{
    readonly type: string;
    readonly threadId?: unknown;
    readonly title?: unknown;
  }> = [];
  const interrupts: Array<{ threadId: ThreadId; runId: RunId | undefined }> = [];
  /** A run's status as the thread reports it; running until a test says otherwise. */
  const runStatus = new Map<RunId, string>();
  /** Runs the thread no longer knows, as after a restart lost them. */
  const vanished = new Set<RunId>();
  /** Room threads whose provider session still runs background work from an earlier turn. */
  const busyInBackground = new Set<ThreadId>();
  const released: Array<string> = [];
  const domainEvents = yield* Queue.unbounded<OrchestrationV2DomainEvent>();
  const applicationEvents = yield* Queue.unbounded<ApplicationStoredEvent>();
  const driver = { current: "codex" };
  const failing = { send: false };
  /** Each bot's chance, as the decision model would answer; `failing` makes it not answer. */
  const router = { available: true, failing: false, scores: new Map<ProjectId, number>() };
  const routed = yield* Queue.unbounded<RoomRouter.RouteInput>();
  /** Every turn the room starts, in order, to await one that starts later. */
  const turns = yield* Queue.unbounded<{ threadId: ThreadId; text: string; runId: RunId }>();

  const finished = new Set<RunId>();
  const shell = (id: ThreadId, projectId: ProjectId, runtimeMode: RuntimeMode) =>
    ({
      id,
      projectId,
      runtimeMode,
      modelSelection,
      lineage: { rootThreadId: id, parentThreadId: null, relationshipToParent: null },
      pendingBackgroundTasks: busyInBackground.has(id)
        ? [{ taskId: "task-1", kind: "subagent" }]
        : [],
      activeRunId:
        sent.findLast((entry) => entry.threadId === id && !finished.has(entry.runId))?.runId ??
        null,
    }) as unknown as OrchestrationV2ThreadShell;
  const shellOf = (id: ThreadId) =>
    shell(id, threads.get(id)!.projectId, threads.get(id)!.runtimeMode);

  const threadManagement = Layer.mock(ThreadManagement.ThreadManagementService)({
    getThreadShell: (id) =>
      Effect.succeed(
        threads.has(id)
          ? shell(id, threads.get(id)!.projectId, threads.get(id)!.runtimeMode)
          : null,
      ),
    listProjectThreads: ({ projectId }) =>
      Effect.succeed(
        projectId === undefined
          ? [...threads].map(([id, thread]) => shell(id, thread.projectId, thread.runtimeMode))
          : [shell(ThreadId.make(`main:${projectId}`), projectId, "full-access")],
      ),
    dispatch: (command) =>
      Effect.sync(() => {
        dispatched.push(command);
        if (command.type === "thread.delete") threads.delete(command.threadId);
        if (command.type === "thread.create") {
          threads.set(command.threadId, {
            projectId: command.projectId,
            runtimeMode: command.runtimeMode,
          });
        }
        if (command.type === "runtime-request.respond") {
          responded.push({ threadId: command.threadId, requestId: command.requestId });
        }
        if (command.type === "thread.runtime-mode.set") {
          const thread = threads.get(command.threadId);
          if (thread !== undefined) thread.runtimeMode = command.runtimeMode;
        }
        return { sequence: 1 } as never;
      }),
    sendToThread: (input) =>
      failing.send
        ? (Effect.fail(
            new ThreadManagement.ThreadManagementProviderInstanceDisabledError({
              projectId: input.projectId,
              instanceId: modelSelection.instanceId,
            }),
          ) as never)
        : Effect.gen(function* () {
            const runId = RunId.make(`run-${sent.length + 1}`);
            sent.push({
              threadId: input.threadId,
              text: input.text,
              runId,
              attachments: input.attachments,
            });
            yield* Queue.offer(turns, { threadId: input.threadId, text: input.text, runId });
            return { run: { id: runId }, delivery: "started" } as never;
          }),
    getThreadRecords: ((threadId: ThreadId) =>
      Effect.succeed({
        messages: replies.get(threadId) ?? [],
        // Every turn the room started is still running until the test finishes it.
        runs: sent
          .filter((entry) => entry.threadId === threadId && !vanished.has(entry.runId))
          .map((entry) => ({ id: entry.runId, status: runStatus.get(entry.runId) ?? "running" })),
        runtimeRequests: waiting.get(threadId)?.runtimeRequests ?? [],
        turnItems: waiting.get(threadId)?.turnItems ?? [],
      })) as never,
    interruptThread: (input) =>
      Effect.sync(() => {
        interrupts.push({ threadId: input.threadId, runId: input.runId });
        const active = threads.has(input.threadId) && shellOf(input.threadId).activeRunId !== null;
        return {
          type: input.runId !== undefined || active ? "interrupt_requested" : "no_active_run",
        };
      }) as never,
    streamDomainEvents: Stream.fromQueue(domainEvents),
  });

  const membersLayer = Layer.mock(Members.Members)({
    list: Effect.sync(() => members),
    subscribe: Stream.fromQueue(memberChanges),
  });

  const projectsLayer = Layer.mock(ProjectService.ProjectService)({
    getById: (id) => Effect.succeed(Option.fromNullishOr(bots.get(id))),
    listShells: () => Effect.succeed([...bots.values()] as never),
  });

  const pushes: Array<{ readonly text: string; readonly audiences: ReadonlyArray<unknown> }> = [];
  const relayLayer = Layer.mock(AgentAwarenessRelay.AgentAwarenessRelay)({
    publishRoomMessage: (input) =>
      Effect.sync(() => pushes.push({ text: input.text, audiences: input.audiences })),
  });
  const claimsLayer = Layer.mock(RoomAttachmentClaims.RoomAttachmentClaims)({
    claim: (_roomId, attachments) => Effect.succeed(attachments),
    release: (_roomId, attachments) =>
      Effect.sync(() => released.push(...attachments.map((attachment) => attachment.id))),
  });
  const database = yield* Layer.build(SqlitePersistence.layerMemory);
  /** The rooms service on this harness's database; again, it is the server starting over. */
  const start = Effect.gen(function* () {
    const context = yield* Rooms.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          threadManagement,
          membersLayer,
          projectsLayer,
          ServerSettings.layerTest({ ownerName: "Peter" }),
          relayLayer,
          claimsLayer,
          Layer.mock(OrchestrationEventStore.OrchestrationEventStore)({
            latestApplicationSequence: Effect.succeed(0),
            streamApplicationEvents: () => Stream.fromQueue(applicationEvents),
          }),
          Layer.mock(ProviderInstanceRegistry.ProviderInstanceRegistry)({
            getInstance: () => Effect.sync(() => ({ driverKind: driver.current }) as never),
          }),
          Layer.mock(RoomRouter.RoomRouter)({
            available: Effect.sync(() => router.available),
            score: (input) =>
              Queue.offer(routed, input).pipe(
                Effect.andThen(
                  router.failing
                    ? Effect.fail(new RoomRouter.RoomRouterError({ reason: "failed" }))
                    : Effect.succeed(
                        input.candidates.map((candidate) => ({
                          projectId: candidate.projectId,
                          probability: router.scores.get(candidate.projectId) ?? 0,
                        })),
                      ),
                ),
              ),
          }),
        ),
      ),
      Layer.provide(Layer.succeedContext(database)),
      Layer.provide(PlatformNodeCrypto.layer),
      Layer.build,
    );
    return Context.get(context, Rooms.Rooms);
  });
  const rooms = yield* start;

  let replyCount = 0;
  /** The bot's turn on `runId` ends with `text` as its last message; `finish` reports it. */
  const writeReply = (roomId: RoomId, projectId: ProjectId, runId: RunId, text: string) =>
    Effect.sync(() => {
      const threadId = botRoomThreadId(roomId, projectId);
      replyCount += 1;
      replies.set(threadId, [
        ...(replies.get(threadId) ?? []),
        {
          id: MessageId.make(`reply-${replyCount}`),
          threadId,
          runId,
          role: "assistant",
          text,
          attachments: [],
        } as unknown as OrchestrationV2ConversationMessage,
      ]);
      finished.add(runId);
      runStatus.set(runId, "completed");
      return threadId;
    });
  const reply = (roomId: RoomId, projectId: ProjectId, runId: RunId, text: string) =>
    writeReply(roomId, projectId, runId, text).pipe(
      Effect.flatMap((threadId) => rooms.finishTurn(threadId, { id: runId, status: "completed" })),
    );

  let posts = 0;
  const post = (
    viewer: Rooms.RoomViewer,
    roomId: RoomId,
    text: string,
    mentions: ReadonlyArray<ProjectId> = [],
    attachments: ReadonlyArray<ChatAttachment> = [],
  ) =>
    Effect.gen(function* () {
      posts += 1;
      yield* rooms.post(viewer, {
        roomId,
        messageId: RoomMessageId.make(`post-${posts}`),
        text,
        mentions,
        attachments,
      });
    });

  /** The bot's room thread stops for an approval, as a provider would report it. */
  const askApproval = (
    roomId: RoomId,
    projectId: ProjectId,
    requestId: string,
    options?: ReadonlyArray<{ readonly decision: string; readonly label: string }>,
  ) =>
    Effect.gen(function* () {
      const threadId = botRoomThreadId(roomId, projectId);
      waiting.set(threadId, {
        runtimeRequests: [
          {
            id: requestId,
            kind: "command",
            status: "pending",
            createdAt: DateTime.makeUnsafe("2026-11-09T12:00:00Z"),
          },
        ],
        turnItems: [
          {
            type: "approval_request",
            requestId,
            requestKind: "command",
            prompt: "rm -rf build",
            ...(options === undefined ? {} : { options }),
          },
        ],
      });
      yield* Queue.offer(domainEvents, {
        type: "runtime-request.updated",
        threadId,
      } as unknown as OrchestrationV2DomainEvent);
    });

  const removeMember = (id: EnvironmentMemberId) =>
    Effect.gen(function* () {
      members = { ...members, members: members.members.filter((entry) => entry.id !== id) };
      yield* Queue.offer(memberChanges, members);
    });

  /** The bot's project is deleted, as `ProjectService.delete` commits it. */
  const deleteBot = (projectId: ProjectId) =>
    Effect.gen(function* () {
      bots.set(projectId, {
        ...bots.get(projectId)!,
        deletedAt: "2026-11-10T00:00:00.000Z",
      } as never);
      yield* Queue.offer(applicationEvents, {
        type: "project.deleted",
        aggregateKind: "project",
        aggregateId: projectId,
      } as unknown as ApplicationStoredEvent);
    });

  return {
    rooms,
    start,
    sent,
    threads,
    shellOf,
    writeReply,
    reply,
    post,
    removeMember,
    deleteBot,
    pushes,
    askApproval,
    responded,
    dispatched,
    interrupts,
    runStatus,
    vanished,
    busyInBackground,
    released,
    bots,
    finished,
    failing,
    driver,
    router,
    routed,
    turns,
  };
});

const roomWithEveryone = (rooms: Rooms.Rooms["Service"]) =>
  rooms.create(owner, {
    title: "Trip",
    memberIds: [anna],
    botProjectIds: [scoutId, chefId],
  });

it.effect("a mention hands the bot what it missed, at the access of whoever mentioned it", () =>
  Effect.gen(function* () {
    const { rooms, sent, threads, reply, post } = yield* makeHarness;
    const room = yield* roomWithEveryone(rooms);
    const threadId = botRoomThreadId(room.id, scoutId);

    const photo: ChatAttachment = {
      type: "image",
      id: ChatAttachmentId.make("room-photo"),
      name: "lisbon.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 1024,
    };
    yield* post(asAnna, room.id, "Lisbon in May?", [], [photo]);
    expect(sent).toHaveLength(0);

    yield* post(owner, room.id, "@Scout find us flights", [scoutId]);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.threadId).toBe(threadId);
    expect(sent[0]!.text).toContain("Anna: Lisbon in May? [sent lisbon.jpg]");
    expect(sent[0]!.text).toContain("Peter (to you): @Scout find us flights");
    // What people sent while the bot was away comes along with the mention.
    expect(sent[0]!.attachments).toEqual([photo]);
    expect(threads.get(threadId)?.runtimeMode).toBe("full-access");

    yield* reply(room.id, scoutId, sent[0]!.runId, "TAP has a direct flight.");
    // Scout's reply is new to Anna until she reads it; her own messages never are.
    const annaView = () =>
      rooms.subscribe(asAnna).pipe(
        Stream.runHead,
        Effect.map((view) => Option.getOrThrow(view).rooms.find((entry) => entry.id === room.id)),
      );
    const unreadRoom = yield* annaView();
    expect(unreadRoom?.unread).toBe(true);
    yield* rooms.markRead(asAnna, room.id, unreadRoom!.lastMessage!.seq);
    expect((yield* annaView())?.unread).toBe(false);
    yield* post(asAnna, room.id, "@Scout book it", [scoutId]);
    expect((yield* annaView())?.unread).toBe(false);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.text).not.toContain("TAP has a direct flight.");
    expect(sent[1]!.attachments).toEqual([]);
    expect(threads.get(threadId)?.runtimeMode).toBe("approval-required");

    const history = yield* rooms.history(owner, { roomId: room.id });
    expect(history.messages.map((message) => [message.authorName, message.text])).toEqual([
      ["Anna", "Lisbon in May?"],
      ["Peter", "@Scout find us flights"],
      ["Scout", "TAP has a direct flight."],
      ["Anna", "@Scout book it"],
    ]);
  }),
);

it.effect("a mention during a turn waits for it, and a reply is copied once", () =>
  Effect.gen(function* () {
    const { rooms, sent, reply, post } = yield* makeHarness;
    const room = yield* roomWithEveryone(rooms);

    yield* post(owner, room.id, "@Scout one", [scoutId]);
    yield* post(asAnna, room.id, "@Scout two", [scoutId]);
    expect(sent).toHaveLength(1);

    yield* reply(room.id, scoutId, sent[0]!.runId, "Done with one.");
    yield* rooms.finishTurn(botRoomThreadId(room.id, scoutId), {
      id: sent[0]!.runId,
      status: "completed",
    });
    expect(sent).toHaveLength(2);
    expect(sent[1]!.text).toContain("Anna (to you): @Scout two");
    const history = yield* rooms.history(owner, { roomId: room.id });
    expect(history.messages.filter((message) => message.text === "Done with one.")).toHaveLength(1);
  }),
);

it.effect("a bot added later reads what was said before it joined", () =>
  Effect.gen(function* () {
    const { rooms, sent, post } = yield* makeHarness;
    const room = yield* rooms.create(owner, {
      title: "Trip",
      memberIds: [anna],
      botProjectIds: [scoutId],
    });
    yield* post(asAnna, room.id, "Lisbon or Porto?");
    yield* rooms.addParticipant(owner, room.id, { kind: "bot", projectId: chefId });

    yield* post(owner, room.id, "@Chef wdyt?", [chefId]);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain("Anna: Lisbon or Porto?");
  }),
);

it.effect("bots handing work to each other stop after three bot-started turns", () =>
  Effect.gen(function* () {
    const { rooms, sent, reply, post } = yield* makeHarness;
    const room = yield* roomWithEveryone(rooms);

    yield* post(owner, room.id, "@Scout start", [scoutId]);
    for (let turn = 0; turn < 4; turn += 1) {
      const last = sent.at(-1)!;
      const from = last.threadId === botRoomThreadId(room.id, scoutId) ? scoutId : chefId;
      yield* reply(
        room.id,
        from,
        last.runId,
        from === scoutId ? "@Chef your turn" : "@Scout yours",
      );
    }
    expect(sent).toHaveLength(4);
    const history = yield* rooms.history(owner, { roomId: room.id });
    expect(history.messages.at(-1)?.author).toEqual({ kind: "system" });
  }),
);

it.effect("a bot posting to another room carries the human and hand-offs of its turn", () =>
  Effect.gen(function* () {
    const { rooms, sent, threads, shellOf, reply, post } = yield* makeHarness;
    const trip = yield* roomWithEveryone(rooms);
    const dinner = yield* rooms.create(owner, {
      title: "Dinner",
      memberIds: [],
      botProjectIds: [scoutId, chefId],
    });
    const inTrip = (projectId: ProjectId) => botRoomThreadId(trip.id, projectId);
    const postFrom = (projectId: ProjectId, text: string) =>
      rooms.postAsBot({ from: shellOf(inTrip(projectId)), roomId: dinner.id, text });

    // Anna asked; Chef answers in a room she is not in, still at her access.
    yield* post(asAnna, trip.id, "@Scout ask Chef about dinner", [scoutId]);
    yield* postFrom(scoutId, "@Chef what's for dinner?");
    expect(sent.at(-1)?.threadId).toBe(botRoomThreadId(dinner.id, chefId));
    expect(threads.get(botRoomThreadId(dinner.id, chefId))?.runtimeMode).toBe("approval-required");

    // So is work that turn started, such as a delegated task's thread.
    const delegated = {
      id: ThreadId.make("thread:delegated"),
      lineage: {
        rootThreadId: inTrip(scoutId),
        parentThreadId: inTrip(scoutId),
        relationshipToParent: "subagent" as const,
      },
    };
    expect((yield* rooms.turnOf(delegated))?.linkOrigin?.memberId).toBe(anna);

    // Hand-offs keep counting across rooms; a thread whose turn ended acts for nobody.
    yield* reply(trip.id, scoutId, sent[0]!.runId, "@Chef your turn");
    expect(
      yield* postFrom(scoutId, "@Chef late").pipe(
        Effect.match({ onFailure: (error) => error.reason, onSuccess: () => "posted" }),
      ),
    ).toBe("not-allowed");
    yield* reply(trip.id, chefId, sent.at(-1)!.runId, "@Scout yours");
    yield* reply(trip.id, scoutId, sent.at(-1)!.runId, "@Chef again");
    expect(sent.at(-1)?.threadId).toBe(inTrip(chefId));
    const before = sent.length;
    yield* postFrom(chefId, "@Scout over to you");
    expect(sent).toHaveLength(before);
    const history = yield* rooms.history(owner, { roomId: dinner.id });
    expect(history.messages.at(-1)?.author).toEqual({ kind: "system" });
  }),
);

it.effect("members reach only rooms they are in, with bots shared with them", () =>
  Effect.gen(function* () {
    const { rooms } = yield* makeHarness;
    const reason = <A>(effect: Effect.Effect<A, RoomsError>) =>
      effect.pipe(
        Effect.match({ onFailure: (error) => error.reason, onSuccess: () => "succeeded" }),
      );

    expect(
      yield* reason(rooms.create(asBen, { title: "Ben's", memberIds: [], botProjectIds: [] })),
    ).toBe("not-allowed");
    expect(
      yield* reason(
        rooms.create(asAnna, { title: "Anna's", memberIds: [], botProjectIds: [chefId] }),
      ),
    ).toBe("bot-not-shared");

    const room = yield* rooms.create(asAnna, {
      title: "Anna's",
      memberIds: [],
      botProjectIds: [scoutId],
    });
    expect(yield* reason(rooms.history(asBen, { roomId: room.id }))).toBe("not-found");
    expect(
      yield* reason(rooms.addParticipant(asAnna, room.id, { kind: "bot", projectId: chefId })),
    ).toBe("bot-not-shared");

    const ownerView = (yield* rooms.subscribe(owner).pipe(Stream.runHead)).pipe(Option.getOrThrow);
    expect(ownerView.rooms.find((entry) => entry.id === room.id)).toMatchObject({
      joined: false,
      lastMessage: null,
    });
    expect(yield* reason(rooms.history(owner, { roomId: room.id }))).toBe("not-found");
    yield* rooms.remove(owner, room.id);
  }),
);

it.effect("a removed member leaves every room", () =>
  Effect.gen(function* () {
    const { rooms, removeMember, post, interrupts } = yield* makeHarness;
    const room = yield* roomWithEveryone(rooms);
    yield* post(asAnna, room.id, "@Scout clean up", [scoutId]);
    const first = yield* Deferred.make<void>();
    // Her turn goes with her: nobody could answer for it, and it ran at her access.
    const settled = yield* rooms.subscribe(owner).pipe(
      Stream.tap(() => Deferred.succeed(first, undefined)),
      Stream.map((view) => view.rooms.find((entry) => entry.id === room.id)!),
      Stream.filter((view) => view.working.length === 0),
      Stream.runHead,
      Effect.forkChild,
    );
    yield* Deferred.await(first);

    yield* removeMember(anna);
    const view = Option.getOrThrow(yield* Fiber.join(settled));
    expect(view.participants.map((participant) => participant.name)).toEqual([
      "Peter",
      "Scout",
      "Chef",
    ]);
    expect(interrupts.map((entry) => entry.threadId)).toEqual([botRoomThreadId(room.id, scoutId)]);
  }),
);

it.effect("a feed goes quiet when its viewer leaves and starts over when they are back", () =>
  Effect.gen(function* () {
    const { rooms, post } = yield* makeHarness;
    const room = yield* roomWithEveryone(rooms);
    yield* post(owner, room.id, "before", []);
    const seen: Array<RoomFeedItem> = [];
    const opened = yield* Deferred.make<void>();
    const rejoined = yield* Deferred.make<void>();
    yield* rooms.feed(asAnna, room.id).pipe(
      Stream.runForEach((item) => {
        seen.push(item);
        if (item.kind !== "requests") return Effect.void;
        const snapshots = seen.filter((entry) => entry.kind === "snapshot").length;
        return Deferred.succeed(snapshots > 1 ? rejoined : opened, undefined);
      }),
      Effect.forkChild,
    );
    yield* Deferred.await(opened);

    yield* rooms.leave(asAnna, room.id);
    yield* post(owner, room.id, "while Anna was out", []);
    yield* rooms.addParticipant(owner, room.id, { kind: "member", memberId: anna });
    yield* Deferred.await(rejoined);

    const snapshots = seen.filter((item) => item.kind === "snapshot");
    expect(snapshots).toHaveLength(2);
    expect(
      snapshots[1]?.kind === "snapshot" ? snapshots[1].history.messages.at(-1)?.text : "",
    ).toBe("Peter added Anna.");
    // Nothing said while she was out reached her as a live message.
    expect(
      seen.flatMap((item) => (item.kind === "message" ? [item.message.text] : [])),
    ).not.toContain("while Anna was out");
  }),
);

it.effect("a bot's approval waits for the person it asked, or the owner", () =>
  Effect.gen(function* () {
    const { rooms, sent, post, askApproval, responded } = yield* makeHarness;
    const room = yield* roomWithEveryone(rooms);
    yield* post(asAnna, room.id, "@Scout clean up", [scoutId]);
    expect(sent).toHaveLength(1);

    const annaFeed = yield* rooms.feed(asAnna, room.id).pipe(
      Stream.filter((item) => item.kind === "requests" && item.requests.length > 0),
      Stream.runHead,
      Effect.forkChild,
    );
    yield* askApproval(room.id, scoutId, "request-1", [
      { decision: "accept", label: "Allow once" },
      { decision: "acceptForSession", label: "Allow for this session" },
      { decision: "decline", label: "Decline" },
    ]);
    const seen = Option.getOrThrow(yield* Fiber.join(annaFeed));
    expect(seen.kind === "requests" ? seen.requests : []).toEqual([
      expect.objectContaining({
        botName: "Scout",
        kind: "approval",
        prompt: "rm -rf build",
        askedForName: "Anna",
        canAnswer: true,
        // A grant for the session would carry into turns other people start.
        options: [
          { decision: "accept", label: "Allow once" },
          { decision: "decline", label: "Decline" },
        ],
      }),
    ]);

    // Ben is not in the room; and nobody but Anna or the owner answers Anna's request.
    const reasonOf = <A>(effect: Effect.Effect<A, RoomsError>) =>
      effect.pipe(
        Effect.match({ onFailure: (error) => error.reason, onSuccess: () => "answered" }),
      );
    const answer = { roomId: room.id, projectId: scoutId, requestId: "request-1" as never };
    expect(yield* reasonOf(rooms.respond(asBen, { ...answer, decision: "accept" }))).toBe(
      "not-found",
    );
    expect(
      yield* reasonOf(rooms.respond(asAnna, { ...answer, decision: "acceptForSession" })),
    ).toBe("not-allowed");
    expect(yield* reasonOf(rooms.respond(owner, { ...answer, decision: "accept" }))).toBe(
      "answered",
    );
    expect(responded).toEqual([
      { threadId: botRoomThreadId(room.id, scoutId), requestId: "request-1" },
    ]);
  }),
);

it.effect("a bot whose provider cannot see images gets them by name", () =>
  Effect.gen(function* () {
    const { rooms, sent, post, driver } = yield* makeHarness;
    const room = yield* roomWithEveryone(rooms);
    driver.current = "acpRegistry";
    const photo: ChatAttachment = {
      type: "image",
      id: ChatAttachmentId.make("room-photo"),
      name: "map.png",
      mimeType: "image/png",
      sizeBytes: 512,
    };
    yield* post(owner, room.id, "@Chef what's near here?", [chefId], [photo]);
    // An image in its prompt would make the provider refuse the whole turn.
    expect(sent[0]!.attachments).toEqual([]);
    expect(sent[0]!.text).toContain("[sent an image, map.png, which you can't see]");
  }),
);

const reasonOf = <A>(effect: Effect.Effect<A, RoomsError>) =>
  effect.pipe(Effect.match({ onFailure: (error) => error.reason, onSuccess: () => "succeeded" }));

const summaryFor = (rooms: Rooms.Rooms["Service"], viewer: Rooms.RoomViewer, roomId: RoomId) =>
  rooms.subscribe(viewer).pipe(
    Stream.runHead,
    Effect.map((view) => Option.getOrThrow(view).rooms.find((entry) => entry.id === roomId)),
  );

const textsOf = (rooms: Rooms.Rooms["Service"], roomId: RoomId) =>
  rooms
    .history(owner, { roomId })
    .pipe(Effect.map((history) => history.messages.map((message) => message.text)));

it.effect("anyone in the room stops a working bot, and the turn it was asked for next", () =>
  Effect.gen(function* () {
    const { rooms, sent, interrupts, shellOf, post } = yield* makeHarness;
    const room = yield* roomWithEveryone(rooms);
    const threadId = botRoomThreadId(room.id, scoutId);
    yield* post(owner, room.id, "@Scout plan the whole trip", [scoutId]);
    yield* post(asAnna, room.id, "@Scout and book it", [scoutId]);

    expect(yield* reasonOf(rooms.interrupt(asBen, room.id, scoutId))).toBe("not-found");
    yield* rooms.interrupt(asAnna, room.id, scoutId);
    expect(interrupts).toEqual([{ threadId, runId: sent[0]!.runId }]);
    expect((yield* summaryFor(rooms, owner, room.id))?.working).toEqual([]);
    expect((yield* textsOf(rooms, room.id)).at(-1)).toBe("Anna stopped Scout.");
    // Whatever the stopped run still does acts for nobody, and its end starts nothing.
    expect(yield* reasonOf(rooms.turnOf(shellOf(threadId)))).toBe("not-allowed");
    yield* rooms.finishTurn(threadId, { id: sent[0]!.runId, status: "interrupted" });
    expect(sent).toHaveLength(1);
  }),
);

it.effect("a human who leaves takes the turns they started, and what waits on them", () =>
  Effect.gen(function* () {
    const { rooms, sent, interrupts, post, askApproval } = yield* makeHarness;
    const room = yield* roomWithEveryone(rooms);
    yield* post(asAnna, room.id, "@Scout clean up", [scoutId]);
    yield* post(owner, room.id, "@Chef what's for dinner?", [chefId]);
    yield* askApproval(room.id, scoutId, "request-1");
    const requests = rooms.feed(owner, room.id).pipe(
      Stream.filter((item) => item.kind === "requests"),
      Stream.map((item) => (item.kind === "requests" ? item.requests.length : -1)),
    );
    yield* requests.pipe(
      Stream.filter((count) => count === 1),
      Stream.runHead,
    );

    yield* rooms.leave(asAnna, room.id);
    expect(interrupts).toEqual([
      { threadId: botRoomThreadId(room.id, scoutId), runId: sent[0]!.runId },
    ]);
    expect((yield* summaryFor(rooms, owner, room.id))?.working).toEqual([chefId]);
    expect(Option.getOrThrow(yield* requests.pipe(Stream.runHead))).toBe(0);
    expect((yield* textsOf(rooms, room.id)).slice(-2)).toEqual([
      "Anna left.",
      "Scout stopped, since Anna left.",
    ]);
  }),
);

it.effect("only the owner takes the owner out of a room", () =>
  Effect.gen(function* () {
    const { rooms } = yield* makeHarness;
    const room = yield* rooms.create(asAnna, {
      title: "Anna's",
      memberIds: [],
      botProjectIds: [scoutId],
      includeOwner: true,
    });
    expect(yield* reasonOf(rooms.removeParticipant(asAnna, room.id, owner))).toBe("not-allowed");
    yield* rooms.leave(owner, room.id);
    expect(
      (yield* summaryFor(rooms, asAnna, room.id))?.participants.map((entry) => entry.name),
    ).toEqual(["Anna", "Scout"]);
  }),
);

it.effect("changes in a room show in it, without counting as unread", () =>
  Effect.gen(function* () {
    const { rooms, post, dispatched } = yield* makeHarness;
    const room = yield* rooms.create(owner, {
      title: "Trip",
      memberIds: [anna],
      botProjectIds: [scoutId],
    });
    yield* post(owner, room.id, "@Scout hi", [scoutId]);

    yield* rooms.rename(owner, room.id, "Lisbon");
    yield* rooms.addParticipant(owner, room.id, { kind: "bot", projectId: chefId });
    yield* rooms.removeParticipant(owner, room.id, { kind: "bot", projectId: chefId });
    expect((yield* textsOf(rooms, room.id)).slice(-3)).toEqual([
      'Peter renamed the chat to "Lisbon".',
      "Peter added Chef.",
      "Peter removed Chef.",
    ]);
    // Peter's message is still new to Anna after the notes that followed it.
    expect((yield* summaryFor(rooms, asAnna, room.id))?.unread).toBe(true);
    // The hidden thread is listed under the room's new name.
    expect(dispatched).toContainEqual(
      expect.objectContaining({
        type: "thread.metadata.update",
        threadId: botRoomThreadId(room.id, scoutId),
        title: "Lisbon",
      }),
    );
  }),
);

it.effect("a bot that can't take its turn says so in the room", () =>
  Effect.gen(function* () {
    const { rooms, sent, post, failing, bots } = yield* makeHarness;
    const room = yield* roomWithEveryone(rooms);
    failing.send = true;
    yield* post(owner, room.id, "@Scout hi", [scoutId]);
    expect((yield* textsOf(rooms, room.id)).at(-1)).toBe("Scout couldn't answer.");
    failing.send = false;

    bots.set(scoutId, { ...bots.get(scoutId)!, archivedAt: "2026-11-09T00:00:00.000Z" } as never);
    yield* post(owner, room.id, "@Scout hi again", [scoutId]);
    expect((yield* textsOf(rooms, room.id)).at(-1)).toBe("Scout is archived, so it can't answer.");

    // A deleted bot leaves the rooms it was in the next time someone asks for it.
    bots.set(chefId, { ...bots.get(chefId)!, deletedAt: "2026-11-09T00:00:00.000Z" } as never);
    yield* post(owner, room.id, "@Chef hi", [chefId]);
    expect(sent).toHaveLength(0);
    expect((yield* textsOf(rooms, room.id)).at(-1)).toBe("Chef was deleted, so it left.");
    expect(
      (yield* summaryFor(rooms, owner, room.id))?.participants.map((entry) => entry.name),
    ).toEqual(["Peter", "Anna", "Scout"]);
  }),
);

it.effect("a deleted bot leaves every room it is in right away, stopping its turn there", () =>
  Effect.gen(function* () {
    const { rooms, start, sent, interrupts, post, askApproval, deleteBot, bots } =
      yield* makeHarness;
    const trip = yield* roomWithEveryone(rooms);
    const kitchen = yield* rooms.create(owner, {
      title: "Kitchen",
      memberIds: [],
      botProjectIds: [chefId],
    });
    const scouting = yield* rooms.create(owner, {
      title: "Scouting",
      memberIds: [anna],
      botProjectIds: [scoutId],
    });
    yield* post(owner, trip.id, "@Chef what's for dinner?", [chefId]);
    yield* post(asAnna, trip.id, "@Chef and dessert", [chefId]);
    yield* askApproval(trip.id, chefId, "request-1");
    const requests = rooms.feed(owner, trip.id).pipe(
      Stream.filter((item) => item.kind === "requests"),
      Stream.map((item) => (item.kind === "requests" ? item.requests.length : -1)),
    );
    yield* requests.pipe(
      Stream.filter((count) => count === 1),
      Stream.runHead,
    );

    yield* deleteBot(chefId);
    const namesIn = (view: RoomsSnapshot, roomId: RoomId) =>
      view.rooms.find((entry) => entry.id === roomId)?.participants.map((entry) => entry.name);
    const view = Option.getOrThrow(
      yield* rooms.subscribe(owner).pipe(
        Stream.filter(
          (current) =>
            !namesIn(current, trip.id)?.includes("Chef") &&
            !namesIn(current, kitchen.id)?.includes("Chef"),
        ),
        Stream.runHead,
      ),
    );
    expect(namesIn(view, trip.id)).toEqual(["Peter", "Anna", "Scout"]);
    expect(namesIn(view, kitchen.id)).toEqual(["Peter"]);
    expect(namesIn(view, scouting.id)).toEqual(["Peter", "Anna", "Scout"]);
    expect(view.rooms.find((entry) => entry.id === trip.id)?.working).toEqual([]);
    // Its turn stops, the one it was asked for next never starts, and its approval goes with it.
    expect(interrupts).toEqual([
      { threadId: botRoomThreadId(trip.id, chefId), runId: sent[0]!.runId },
    ]);
    expect(sent).toHaveLength(1);
    expect(Option.getOrThrow(yield* requests.pipe(Stream.runHead))).toBe(0);
    const note = "Chef was deleted, so it left.";
    expect((yield* textsOf(rooms, trip.id)).filter((text) => text === note)).toHaveLength(1);
    expect((yield* textsOf(rooms, kitchen.id)).filter((text) => text === note)).toHaveLength(1);
    expect(yield* textsOf(rooms, scouting.id)).toEqual([]);

    // Deleted while the server was down, as from the CLI: it leaves when the server starts.
    bots.set(scoutId, { ...bots.get(scoutId)!, deletedAt: "2026-11-10T00:00:00.000Z" } as never);
    const restarted = yield* start;
    const after = Option.getOrThrow(
      yield* restarted.subscribe(owner).pipe(
        Stream.filter((current) => !namesIn(current, scouting.id)?.includes("Scout")),
        Stream.runHead,
      ),
    );
    expect(namesIn(after, scouting.id)).toEqual(["Peter", "Anna"]);
    expect(yield* textsOf(restarted, scouting.id)).toEqual(["Scout was deleted, so it left."]);
  }),
);

it.effect("deleting a room deletes its bots' threads and the files sent in it", () =>
  Effect.gen(function* () {
    const { rooms, post, dispatched, released, threads } = yield* makeHarness;
    const room = yield* roomWithEveryone(rooms);
    const photo: ChatAttachment = {
      type: "image",
      id: ChatAttachmentId.make("room-photo"),
      name: "lisbon.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 1024,
    };
    yield* post(asAnna, room.id, "Look", [], [photo]);
    yield* post(owner, room.id, "@Scout @Chef thoughts?", [scoutId, chefId]);
    // A bot that left keeps its thread as background work until the room goes.
    yield* rooms.removeParticipant(owner, room.id, { kind: "bot", projectId: chefId });

    yield* rooms.remove(owner, room.id);
    expect(
      dispatched.filter((command) => command.type === "thread.delete").map((c) => c.threadId),
    ).toEqual(
      expect.arrayContaining([botRoomThreadId(room.id, scoutId), botRoomThreadId(room.id, chefId)]),
    );
    expect(threads.size).toBe(0);
    expect(released).toEqual(["room-photo"]);
  }),
);

it.effect("background work from a turn keeps the next one at the lesser access", () =>
  Effect.gen(function* () {
    const { rooms, sent, threads, shellOf, reply, post, busyInBackground } = yield* makeHarness;
    const room = yield* roomWithEveryone(rooms);
    const threadId = botRoomThreadId(room.id, scoutId);
    yield* post(asAnna, room.id, "@Scout research this in the background", [scoutId]);
    busyInBackground.add(threadId);
    yield* reply(room.id, scoutId, sent[0]!.runId, "On it.");

    // Anna's background work still calls tools in this session, so Peter's turn runs as hers.
    yield* post(owner, room.id, "@Scout now this", [scoutId]);
    expect(threads.get(threadId)?.runtimeMode).toBe("approval-required");
    expect((yield* rooms.turnOf(shellOf(threadId)))?.linkOrigin?.memberId).toBe(anna);

    busyInBackground.delete(threadId);
    yield* reply(room.id, scoutId, sent[1]!.runId, "Done.");
    yield* post(owner, room.id, "@Scout and this", [scoutId]);
    expect(threads.get(threadId)?.runtimeMode).toBe("full-access");
    expect((yield* rooms.turnOf(shellOf(threadId)))?.linkOrigin).toBeUndefined();
  }),
);

it.effect("after a restart, a run that ended posts once and one that vanished clears", () =>
  Effect.gen(function* () {
    const { rooms, start, sent, post, writeReply, vanished } = yield* makeHarness;
    const room = yield* roomWithEveryone(rooms);
    yield* post(owner, room.id, "@Scout @Chef go", [scoutId, chefId]);
    const scoutRun = sent.find((entry) => entry.threadId === botRoomThreadId(room.id, scoutId))!;
    const chefRun = sent.find((entry) => entry.threadId === botRoomThreadId(room.id, chefId))!;
    // While the server was down, Scout finished and Chef's run was lost.
    yield* writeReply(room.id, scoutId, scoutRun.runId, "Back with flights.");
    vanished.add(chefRun.runId);

    const restarted = yield* start;
    const settled = yield* restarted.subscribe(owner).pipe(
      Stream.map((view) => view.rooms.find((entry) => entry.id === room.id)),
      Stream.filter((summary) => summary?.working.length === 0),
      Stream.runHead,
    );
    expect(Option.getOrThrow(settled)?.lastMessage?.text).toBe("Back with flights.");
    // The run's own end arriving late copies nothing twice.
    yield* restarted.finishTurn(botRoomThreadId(room.id, scoutId), {
      id: scoutRun.runId,
      status: "completed",
    });
    expect(
      (yield* textsOf(restarted, room.id)).filter((text) => text === "Back with flights."),
    ).toHaveLength(1);
  }),
);

it.effect(
  "a message nobody mentioned wakes the likeliest listening bot, which may stay quiet",
  () =>
    Effect.gen(function* () {
      const { rooms, router, routed, turns, reply, post, shellOf } = yield* makeHarness;
      const room = yield* roomWithEveryone(rooms);
      yield* rooms.setListening(owner, {
        roomId: room.id,
        projectId: chefId,
        listening: true,
        listensFor: "  dinner plans ",
      });
      router.scores.set(chefId, 0.9).set(scoutId, 0.4);

      yield* post(asAnna, room.id, "what should we cook tonight?");
      yield* TestClock.adjust("4 seconds");
      const input = yield* Queue.take(routed);
      expect(input.candidates).toEqual([
        expect.objectContaining({ projectId: scoutId, listensFor: null, followUp: false }),
        expect.objectContaining({ projectId: chefId, listensFor: "dinner plans", followUp: false }),
      ]);
      expect(input.messages).toEqual([
        { authorName: "Anna", isBot: false, text: "what should we cook tonight?", isNew: true },
      ]);

      const turn = yield* Queue.take(turns);
      expect(turn.threadId).toBe(botRoomThreadId(room.id, chefId));
      expect(turn.text).toContain("Nobody @mentioned you");
      expect(turn.text).toContain("here for: dinner plans");
      // Mostly these end quietly, so nobody sees the bot typing.
      expect((yield* summaryFor(rooms, owner, room.id))?.working).toEqual([]);

      yield* rooms.stayQuiet(shellOf(turn.threadId));
      yield* reply(room.id, chefId, turn.runId, "No reply needed.");
      expect(yield* textsOf(rooms, room.id)).toEqual(["what should we cook tonight?"]);
      expect(yield* reasonOf(rooms.stayQuiet(shellOf(turn.threadId)))).toBe("not-allowed");
    }),
);

it.effect("a mention keeps other bots out of what came before it, and quiet bots out of all", () =>
  Effect.gen(function* () {
    const { rooms, router, routed, turns, post } = yield* makeHarness;
    const room = yield* roomWithEveryone(rooms);
    yield* rooms.setListening(owner, {
      roomId: room.id,
      projectId: chefId,
      listening: false,
      listensFor: null,
    });
    expect(
      (yield* summaryFor(rooms, owner, room.id))?.participants.find(
        (entry) => entry.participant.kind === "bot" && entry.participant.projectId === chefId,
      )?.listening,
    ).toBe(false);
    router.scores.set(scoutId, 0.1);

    yield* post(owner, room.id, "anyone hungry?");
    yield* post(owner, room.id, "@Scout find us flights", [scoutId]);
    expect((yield* Queue.take(turns)).threadId).toBe(botRoomThreadId(room.id, scoutId));
    yield* TestClock.adjust("4 seconds");

    yield* post(asAnna, room.id, "nice");
    yield* TestClock.adjust("4 seconds");
    const input = yield* Queue.take(routed);
    expect(input.candidates.map((candidate) => candidate.projectId)).toEqual([scoutId]);
    expect(
      input.messages.filter((message) => message.isNew).map((message) => message.text),
    ).toEqual(["nice"]);
  }),
);

it.effect(
  "without an answer the bot that just spoke takes the follow-up, as the least trusted",
  () =>
    Effect.gen(function* () {
      const { rooms, router, turns, threads, reply, post } = yield* makeHarness;
      const room = yield* roomWithEveryone(rooms);
      const threadId = botRoomThreadId(room.id, scoutId);
      yield* post(owner, room.id, "@Scout find us flights", [scoutId]);
      const first = yield* Queue.take(turns);
      yield* reply(room.id, scoutId, first.runId, "TAP has a direct flight.");
      router.failing = true;

      yield* post(owner, room.id, "and hotels?");
      yield* post(asAnna, room.id, "cheap ones");
      yield* TestClock.adjust("4 seconds");
      const followUp = yield* Queue.take(turns);
      expect(followUp.threadId).toBe(threadId);
      expect(followUp.text).toContain("as a follow-up to your last reply");
      expect(threads.get(threadId)?.runtimeMode).toBe("approval-required");
    }),
);
