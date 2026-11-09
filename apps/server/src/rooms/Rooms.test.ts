import * as PlatformNodeCrypto from "@effect/platform-node/NodeCrypto";
import {
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
  type RoomId,
  RoomMessageId,
  type RoomsError,
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

import * as Members from "../members/Members.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as AgentAwarenessRelay from "../relay/AgentAwarenessRelay.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as RoomAttachmentClaims from "./RoomAttachmentClaims.ts";
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
  const domainEvents = yield* Queue.unbounded<OrchestrationV2DomainEvent>();
  const driver = { current: "codex" };

  const shell = (id: ThreadId, projectId: ProjectId, runtimeMode: RuntimeMode) =>
    ({ id, projectId, runtimeMode, modelSelection }) as unknown as OrchestrationV2ThreadShell;

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
          ? []
          : [shell(ThreadId.make(`main:${projectId}`), projectId, "full-access")],
      ),
    dispatch: (command) =>
      Effect.sync(() => {
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
      Effect.sync(() => {
        const runId = RunId.make(`run-${sent.length + 1}`);
        sent.push({
          threadId: input.threadId,
          text: input.text,
          runId,
          attachments: input.attachments,
        });
        return { run: { id: runId }, delivery: "started" } as never;
      }),
    getThreadRecords: ((threadId: ThreadId) =>
      Effect.succeed({
        messages: replies.get(threadId) ?? [],
        // Every turn the room started is still running until the test finishes it.
        runs: sent
          .filter((entry) => entry.threadId === threadId)
          .map((entry) => ({ id: entry.runId, status: "running" })),
        runtimeRequests: waiting.get(threadId)?.runtimeRequests ?? [],
        turnItems: waiting.get(threadId)?.turnItems ?? [],
      })) as never,
    interruptThread: () => Effect.void as never,
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
  });
  const context = yield* Rooms.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        threadManagement,
        membersLayer,
        projectsLayer,
        ServerSettings.layerTest({ ownerName: "Peter" }),
        relayLayer,
        claimsLayer,
        Layer.mock(ProviderInstanceRegistry.ProviderInstanceRegistry)({
          getInstance: () => Effect.sync(() => ({ driverKind: driver.current }) as never),
        }),
      ),
    ),
    Layer.provide(SqlitePersistence.layerMemory),
    Layer.provide(PlatformNodeCrypto.layer),
    Layer.build,
  );
  const rooms = Context.get(context, Rooms.Rooms);

  let replyCount = 0;
  /** The bot's turn on `runId` ends with `text` as its last message. */
  const reply = (roomId: RoomId, projectId: ProjectId, runId: RunId, text: string) =>
    Effect.gen(function* () {
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
      yield* rooms.finishTurn(threadId, { id: runId, status: "completed" });
    });

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
  const askApproval = (roomId: RoomId, projectId: ProjectId, requestId: string) =>
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
          { type: "approval_request", requestId, requestKind: "command", prompt: "rm -rf build" },
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

  return {
    rooms,
    sent,
    threads,
    reply,
    post,
    removeMember,
    pushes,
    askApproval,
    responded,
    driver,
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
    const { rooms, removeMember } = yield* makeHarness;
    const room = yield* roomWithEveryone(rooms);
    const first = yield* Deferred.make<void>();
    const changes = yield* rooms.subscribe(owner).pipe(
      Stream.tap(() => Deferred.succeed(first, undefined)),
      Stream.take(2),
      Stream.runCollect,
      Effect.forkChild,
    );
    yield* Deferred.await(first);

    yield* removeMember(anna);
    const [, after] = yield* Fiber.join(changes);
    const view = after!.rooms.find((entry) => entry.id === room.id)!;
    expect(view.participants.map((participant) => participant.name)).toEqual([
      "Peter",
      "Scout",
      "Chef",
    ]);
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
    yield* askApproval(room.id, scoutId, "request-1");
    const seen = Option.getOrThrow(yield* Fiber.join(annaFeed));
    expect(seen.kind === "requests" ? seen.requests : []).toEqual([
      expect.objectContaining({
        botName: "Scout",
        kind: "approval",
        prompt: "rm -rf build",
        askedForName: "Anna",
        canAnswer: true,
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
