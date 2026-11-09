/**
 * Rooms: group chats with the owner, members and bots. Each bot answers in a hidden thread of its
 * own project; this service hands it what it missed when someone @mentions it, and copies its
 * reply back. See `docs/adr/0003-rooms-front-per-bot-threads.md`.
 */
import {
  botMainThreadId,
  botRoomThreadId,
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  type EnvironmentMember,
  isRoomThreadId,
  isRuntimeModeAbove,
  mentionedBots,
  MessageId,
  type OrchestrationV2Run,
  type Project,
  type ProjectId,
  ROOM_BOT_HOP_LIMIT,
  ROOM_HISTORY_PAGE_SIZE,
  type RoomAuthor,
  type RoomFeedItem,
  type RoomHuman,
  RoomId,
  RoomMessageId,
  type RoomParticipant,
  type RoomPerson,
  roomParticipantKey,
  RoomsError,
  type RoomsCreateInput,
  type RoomsHistory,
  type RoomsHistoryInput,
  type RoomsPostInput,
  type RoomsRespondInput,
  type RoomPendingRequest,
  type OrchestrationV2TurnItem,
  type RoomsSnapshot,
  type RoomSummary,
  type RuntimeMode,
  type ThreadId,
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

import * as Members from "../members/Members.ts";
import { isSharedWithMember, narrowToMemberAccess } from "../members/memberFence.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as RoomStore from "../persistence/Rooms.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { forkParked } from "../serverActivation.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as AgentAwarenessRelay from "../relay/AgentAwarenessRelay.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as RoomAttachmentClaims from "./RoomAttachmentClaims.ts";
import { roomDeliveryText } from "./roomDelivery.ts";

/** Who is asking: the owner, or the member a session belongs to. */
export type RoomViewer = RoomHuman;

/** Until the owner says what to call them. */
const OWNER_FALLBACK_NAME = "Owner";
const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "interrupted", "cancelled"]);
/** Drivers whose prompts carry images natively. */
const IMAGE_DRIVERS: ReadonlySet<string> = new Set(["claudeAgent", "codex"]);

const persistence = (cause: unknown) => new RoomsError({ reason: "persistence", cause });
const notFound = () => new RoomsError({ reason: "not-found" });
const notAllowed = () => new RoomsError({ reason: "not-allowed" });

const isOwner = (viewer: RoomViewer) => viewer.kind === "owner";

/** A waiting request before it is told whether this viewer may answer it. */
type PendingRequest = Omit<RoomPendingRequest, "canAnswer">;

type RoomEventItem =
  | Exclude<RoomFeedItem, { readonly kind: "requests" }>
  | { readonly kind: "requests"; readonly requests: ReadonlyArray<PendingRequest> };

interface RoomEvent {
  readonly roomId: RoomId;
  readonly item: RoomEventItem;
}

const forViewer = (
  requests: ReadonlyArray<PendingRequest>,
  viewer: RoomViewer,
): ReadonlyArray<RoomPendingRequest> =>
  requests.map((request) => ({
    ...request,
    canAnswer:
      viewer.kind === "owner" ||
      roomParticipantKey(request.askedFor) === roomParticipantKey(viewer),
  }));

export class Rooms extends Context.Service<
  Rooms,
  {
    /** The viewer's rooms now, then again after every change. */
    readonly subscribe: (viewer: RoomViewer) => Stream.Stream<RoomsSnapshot, RoomsError>;
    readonly create: (
      viewer: RoomViewer,
      input: RoomsCreateInput,
    ) => Effect.Effect<RoomSummary, RoomsError>;
    readonly rename: (
      viewer: RoomViewer,
      roomId: RoomId,
      title: string,
    ) => Effect.Effect<void, RoomsError>;
    readonly addParticipant: (
      viewer: RoomViewer,
      roomId: RoomId,
      participant: RoomParticipant,
    ) => Effect.Effect<void, RoomsError>;
    readonly removeParticipant: (
      viewer: RoomViewer,
      roomId: RoomId,
      participant: RoomParticipant,
    ) => Effect.Effect<void, RoomsError>;
    readonly leave: (viewer: RoomViewer, roomId: RoomId) => Effect.Effect<void, RoomsError>;
    readonly setArchived: (
      viewer: RoomViewer,
      roomId: RoomId,
      archived: boolean,
    ) => Effect.Effect<void, RoomsError>;
    readonly setMuted: (
      viewer: RoomViewer,
      roomId: RoomId,
      muted: boolean,
    ) => Effect.Effect<void, RoomsError>;
    readonly remove: (viewer: RoomViewer, roomId: RoomId) => Effect.Effect<void, RoomsError>;
    readonly markRead: (
      viewer: RoomViewer,
      roomId: RoomId,
      throughSeq: number,
    ) => Effect.Effect<void, RoomsError>;
    readonly post: (viewer: RoomViewer, input: RoomsPostInput) => Effect.Effect<void, RoomsError>;
    /** Answers a bot's approval or question; the person it asked, or the owner. */
    readonly respond: (
      viewer: RoomViewer,
      input: RoomsRespondInput,
    ) => Effect.Effect<void, RoomsError>;
    readonly history: (
      viewer: RoomViewer,
      input: RoomsHistoryInput,
    ) => Effect.Effect<RoomsHistory, RoomsError>;
    readonly feed: (viewer: RoomViewer, roomId: RoomId) => Stream.Stream<RoomFeedItem, RoomsError>;
    /** The group chats a bot is in, for its tools: who is there and what they are called. */
    readonly roomsOfBot: (projectId: ProjectId) => Effect.Effect<
      ReadonlyArray<{
        readonly roomId: RoomId;
        readonly title: string;
        readonly people: ReadonlyArray<string>;
        readonly bots: ReadonlyArray<string>;
      }>,
      RoomsError
    >;
    /**
     * A bot speaking up in a room on its own, such as from a routine. @mentions start other bots'
     * turns, counted as bot-started turns so they still stop.
     */
    readonly postAsBot: (input: {
      readonly projectId: ProjectId;
      readonly roomId: RoomId;
      readonly text: string;
    }) => Effect.Effect<void, RoomsError>;
    /** Copies a finished room turn's reply into its room; idempotent. */
    readonly finishTurn: (
      threadId: ThreadId,
      run: Pick<OrchestrationV2Run, "id" | "status">,
    ) => Effect.Effect<void, RoomsError>;
  }
>()("boops/rooms/Rooms") {}

const make = Effect.gen(function* () {
  const store = yield* RoomStore.RoomRepository;
  const members = yield* Members.Members;
  const projects = yield* ProjectService.ProjectService;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const random = yield* SecureRandom.SecureRandom;
  const settings = yield* ServerSettings.ServerSettingsService;
  const providerInstances = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const attachmentClaims = yield* RoomAttachmentClaims.RoomAttachmentClaims;
  const relay = yield* AgentAwarenessRelay.AgentAwarenessRelay;
  /** Bots' waiting approvals and questions, by room; refreshed when one opens or closes. */
  const pendingByRoom = new Map<RoomId, ReadonlyArray<PendingRequest>>();

  const listChanges = yield* PubSub.unbounded<void>();
  const roomEvents = yield* PubSub.unbounded<RoomEvent>();
  const botLocks = yield* KeyedLock.make<string>();
  const listChanged = PubSub.publish(listChanges, undefined).pipe(Effect.asVoid);
  const emit = (roomId: RoomId, item: RoomEventItem) =>
    PubSub.publish(roomEvents, { roomId, item }).pipe(Effect.asVoid);

  const uuid = random.uuidV4().pipe(Effect.mapError(persistence));
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const db = <A, E>(effect: Effect.Effect<A, E>) => effect.pipe(Effect.mapError(persistence));

  const memberList = db(members.list).pipe(Effect.map((snapshot) => snapshot.members));
  const bots = db(projects.listShells());

  const requireRoom = (roomId: RoomId) =>
    db(store.getRoom(roomId)).pipe(
      Effect.filterOrFail((room): room is RoomStore.RoomRecord => room !== undefined, notFound),
    );

  const participantsOf = (roomId: RoomId) => db(store.listParticipants(roomId));

  /** The room and its participants, when the viewer is in it. */
  const requireJoined = Effect.fn("Rooms.requireJoined")(function* (
    viewer: RoomViewer,
    roomId: RoomId,
  ) {
    const room = yield* requireRoom(roomId);
    const participants = yield* participantsOf(roomId);
    const key = roomParticipantKey(viewer);
    if (!participants.some((participant) => participant.key === key)) {
      return yield* notFound();
    }
    return { room, participants };
  });

  /** The owner, or the human who created the room, may change who is in it. */
  const requireManager = Effect.fn("Rooms.requireManager")(function* (
    viewer: RoomViewer,
    roomId: RoomId,
  ) {
    const room = yield* requireRoom(roomId);
    if (!isOwner(viewer) && room.createdBy !== roomParticipantKey(viewer)) {
      return yield* notAllowed();
    }
    return room;
  });

  const requireMember = (
    list: ReadonlyArray<EnvironmentMember>,
    memberId: EnvironmentMember["id"],
  ) => {
    const member = list.find((candidate) => candidate.id === memberId);
    return member === undefined
      ? Effect.fail(new RoomsError({ reason: "not-a-member" }))
      : Effect.succeed(member);
  };

  /** A member may bring only the bots shared with them; rooms never grant a bot. */
  const requireBotFor = Effect.fn("Rooms.requireBotFor")(function* (
    viewer: RoomViewer,
    projectId: ProjectId,
  ) {
    const project = yield* db(projects.getById(projectId));
    if (Option.isNone(project) || project.value.deletedAt !== null) {
      return yield* new RoomsError({ reason: "bot-not-shared" });
    }
    if (viewer.kind === "member" && !isSharedWithMember(project.value, viewer.memberId)) {
      return yield* new RoomsError({ reason: "bot-not-shared" });
    }
    return project.value;
  });

  const requireParticipantAllowed = Effect.fn("Rooms.requireParticipantAllowed")(function* (
    viewer: RoomViewer,
    participant: RoomParticipant,
  ) {
    switch (participant.kind) {
      case "owner":
        return;
      case "member":
        yield* requireMember(yield* memberList, participant.memberId);
        return;
      case "bot":
        yield* requireBotFor(viewer, participant.projectId);
        return;
    }
  });

  const nameOf = (
    participant: RoomAuthor,
    names: {
      readonly ownerName: string;
      readonly memberNames: ReadonlyMap<string, string>;
      readonly botNames: ReadonlyMap<string, string>;
    },
  ): string | undefined => {
    const { memberNames, botNames } = names;
    switch (participant.kind) {
      case "owner":
        return names.ownerName;
      case "system":
        return "Boops";
      case "member":
        return memberNames.get(participant.memberId);
      case "bot":
        return botNames.get(participant.projectId);
    }
  };

  const ownerName = settings.getSettings.pipe(
    Effect.map((current) => current.ownerName.trim()),
    Effect.orElseSucceed(() => ""),
  );

  const directory = Effect.gen(function* () {
    const [memberRows, botRows, owner] = yield* Effect.all([memberList, bots, ownerName]);
    return {
      ownerName: owner === "" ? OWNER_FALLBACK_NAME : owner,
      ownerNamed: owner !== "",
      memberNames: new Map(memberRows.map((member) => [member.id as string, member.label])),
      botNames: new Map(botRows.map((bot) => [bot.id as string, bot.title])),
    };
  });

  const listFor = Effect.fn("Rooms.list")(function* (viewer: RoomViewer) {
    const [rooms, participants, lastMessages, names, memberRows] = yield* Effect.all([
      db(store.listRooms),
      db(store.listParticipants()),
      db(store.lastMessages),
      directory,
      memberList,
    ]);
    const viewerKey = roomParticipantKey(viewer);
    const summaries: Array<RoomSummary> = [];
    for (const room of rooms) {
      const inRoom = participants.filter((participant) => participant.roomId === room.id);
      const mine = inRoom.find((participant) => participant.key === viewerKey);
      if (mine === undefined && !isOwner(viewer)) continue;
      const createdBy = RoomStore.parseParticipantKey(room.createdBy);
      summaries.push({
        id: room.id,
        title: room.title,
        createdBy:
          createdBy?.kind === "member" ? createdBy : ({ kind: "owner" } satisfies RoomHuman),
        participants: inRoom.flatMap((participant) => {
          const name = nameOf(participant.participant, names);
          return name === undefined ? [] : [{ participant: participant.participant, name }];
        }),
        joined: mine !== undefined,
        muted: mine?.muted ?? false,
        archivedAt: room.archivedAt,
        createdAt: room.createdAt,
        lastMessage: mine === undefined ? null : (lastMessages.get(room.id) ?? null),
        working:
          mine === undefined
            ? []
            : inRoom.flatMap((participant) =>
                participant.participant.kind === "bot" && participant.turnRunId !== null
                  ? [participant.participant.projectId]
                  : [],
              ),
        unread: (() => {
          const last = lastMessages.get(room.id);
          return (
            mine !== undefined &&
            last !== undefined &&
            last.seq > mine.readSeq &&
            roomParticipantKey(last.author) !== viewerKey &&
            last.author.kind !== "system"
          );
        })(),
        needsYou:
          mine !== undefined &&
          forViewer(pendingByRoom.get(room.id) ?? [], viewer).some((request) => request.canAnswer),
      });
    }
    const canCreate =
      viewer.kind === "owner" ||
      memberRows.some((member) => member.id === viewer.memberId && member.canCreateRooms);
    const people: Array<RoomPerson> = canCreate
      ? [
          { person: { kind: "owner" }, name: names.ownerName } satisfies RoomPerson,
          ...memberRows.map((member): RoomPerson => ({
            person: { kind: "member", memberId: member.id },
            name: member.label,
          })),
        ].filter((entry) => roomParticipantKey(entry.person) !== viewerKey)
      : [];
    return {
      rooms: summaries,
      canCreate,
      people,
      ownerNamed: names.ownerNamed,
    } satisfies RoomsSnapshot;
  });

  const subscribe: Rooms["Service"]["subscribe"] = (viewer) =>
    Stream.unwrap(
      Effect.gen(function* () {
        // Subscribe before the first read so no change between them is missed.
        const signals = yield* PubSub.subscribe(listChanges);
        return Stream.concat(
          Stream.fromEffect(listFor(viewer)),
          Stream.fromSubscription(signals).pipe(Stream.mapEffect(() => listFor(viewer))),
        );
      }),
    );

  const authorNameOf = Effect.fn("Rooms.authorName")(function* (author: RoomAuthor) {
    const names = yield* directory;
    return nameOf(author, names) ?? "Someone";
  });

  /** Everyone else in the room hears it on their phones, unless they muted it. */
  const pushMessage = Effect.fn("Rooms.pushMessage")(
    function* (message: RoomStore.RoomMessageRecord) {
      const room = yield* requireRoom(message.roomId);
      const authorKey = roomParticipantKey(message.author);
      const audiences = (yield* participantsOf(message.roomId)).flatMap((participant) =>
        participant.muted || participant.key === authorKey
          ? []
          : participant.participant.kind === "owner"
            ? [undefined]
            : participant.participant.kind === "member"
              ? [participant.participant.memberId]
              : [],
      );
      if (audiences.length === 0) return;
      yield* relay.publishRoomMessage({
        roomId: message.roomId,
        roomTitle: room.title,
        senderId: authorKey,
        senderName: message.authorName,
        text: message.text,
        audiences,
      });
    },
    Effect.catch((cause) => Effect.logWarning("Could not push a room message", { cause })),
  );

  const appendAndEmit = Effect.fn("Rooms.append")(function* (
    message: Omit<RoomStore.NewRoomMessage, "authorName" | "createdAt">,
  ) {
    const stored = yield* db(
      store.appendMessage({
        ...message,
        authorName: yield* authorNameOf(message.author),
        createdAt: yield* now,
      }),
    );
    if (stored === undefined) return undefined;
    const { hop: _hop, originKey: _originKey, ...visible } = stored;
    yield* emit(stored.roomId, { kind: "message", message: visible });
    yield* listChanged;
    if (stored.author.kind !== "system") yield* Effect.forkDetach(pushMessage(stored));
    return stored;
  });

  const systemNote = Effect.fn("Rooms.systemNote")(function* (
    roomId: RoomId,
    text: string,
    originKey: string,
  ) {
    yield* appendAndEmit({
      id: RoomMessageId.make(`system:${yield* uuid}`),
      roomId,
      author: { kind: "system" },
      text,
      mentions: [],
      attachments: [],
      hop: 0,
      originKey,
    });
  });

  const emitWorking = Effect.fn("Rooms.emitWorking")(function* (roomId: RoomId) {
    const participants = yield* participantsOf(roomId);
    yield* emit(roomId, {
      kind: "working",
      working: participants.flatMap((participant) =>
        participant.participant.kind === "bot" && participant.turnRunId !== null
          ? [participant.participant.projectId]
          : [],
      ),
    });
    yield* listChanged;
  });

  /** The mode a turn runs in: the bot's own, narrowed to the member who started it. */
  const runtimeModeFor = Effect.fn("Rooms.runtimeModeFor")(function* (
    bot: Project,
    originKey: string,
  ) {
    const all = yield* db(
      threads.listProjectThreads({ projectId: bot.id, includeSubagents: false }),
    );
    const mainId = botMainThreadId(
      bot,
      all.filter((thread) => thread.linkOrigin?.memberId === undefined),
    );
    const main = all.find((thread) => thread.id === mainId);
    const botMode: RuntimeMode = main?.runtimeMode ?? "full-access";
    const modelSelection = main?.modelSelection ?? bot.defaultModelSelection;
    const origin = RoomStore.parseParticipantKey(originKey);
    if (origin?.kind !== "member") return { mode: botMode, modelSelection };
    const member = (yield* memberList).find((candidate) => candidate.id === origin.memberId);
    if (member === undefined) return undefined;
    return { mode: narrowToMemberAccess(botMode, member.access), modelSelection };
  });

  /** Of two humans, the one whose turns run with less. */
  const leastTrusted = Effect.fn("Rooms.leastTrusted")(function* (
    bot: Project,
    a: string,
    b: string,
  ) {
    if (a === b) return a;
    const [modeA, modeB] = yield* Effect.all([runtimeModeFor(bot, a), runtimeModeFor(bot, b)]);
    if (modeA === undefined) return a;
    if (modeB === undefined) return b;
    return isRuntimeModeAbove(modeA.mode, modeB.mode) ? b : a;
  });

  const ensureRoomThread = Effect.fn("Rooms.ensureRoomThread")(function* (
    roomId: RoomId,
    roomTitle: string,
    bot: Project,
    runtime: {
      readonly mode: RuntimeMode;
      readonly modelSelection: Project["defaultModelSelection"];
    },
  ) {
    const threadId = botRoomThreadId(roomId, bot.id);
    const existing = yield* threads.getThreadShell(threadId).pipe(Effect.orElseSucceed(() => null));
    const suffix = yield* uuid;
    if (existing === null) {
      const modelSelection = runtime.modelSelection;
      if (modelSelection === null) return undefined;
      yield* db(
        threads.dispatch({
          type: "thread.create",
          createdBy: "user",
          creationSource: "server",
          commandId: CommandId.make(`room-thread:${suffix}`),
          threadId,
          projectId: bot.id,
          title: roomTitle,
          modelSelection,
          runtimeMode: runtime.mode,
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          branch: null,
          worktreePath: null,
        }),
      );
      return threadId;
    }
    if (existing.runtimeMode !== runtime.mode) {
      yield* db(
        threads.dispatch({
          type: "thread.runtime-mode.set",
          commandId: CommandId.make(`room-thread-mode:${suffix}`),
          threadId,
          runtimeMode: runtime.mode,
        }),
      );
    }
    return threadId;
  });

  /** Only some providers take images in a prompt; the rest would refuse the whole turn. */
  const seesImages = Effect.fn("Rooms.seesImages")(function* (
    modelSelection: Project["defaultModelSelection"],
  ) {
    if (modelSelection === null) return false;
    const instance = yield* providerInstances.getInstance(modelSelection.instanceId);
    return instance !== undefined && IMAGE_DRIVERS.has(instance.driverKind);
  });

  /** Starts the bot's turn now; the caller holds its lock and knows it is idle. */
  const startTurn = Effect.fn("Rooms.startTurn")(function* (
    roomId: RoomId,
    projectId: ProjectId,
    hop: number,
    originKey: string,
  ) {
    const botKey = roomParticipantKey({ kind: "bot", projectId });
    const room = yield* requireRoom(roomId);
    const participants = yield* participantsOf(roomId);
    const self = participants.find((participant) => participant.key === botKey);
    if (self === undefined || room.archivedAt !== null) return;
    const project = yield* db(projects.getById(projectId));
    if (Option.isNone(project) || project.value.deletedAt !== null) return;
    const bot = project.value;
    // A member's room keeps a bot only while it is shared with them, unless the owner is there.
    const creator = RoomStore.parseParticipantKey(room.createdBy);
    if (
      creator?.kind === "member" &&
      !participants.some((participant) => participant.key === "owner") &&
      !isSharedWithMember(bot, creator.memberId)
    ) {
      yield* db(store.removeParticipant(roomId, botKey));
      yield* systemNote(roomId, `${bot.title} is no longer shared here, so it left.`, originKey);
      yield* listChanged;
      return;
    }
    const runtime = yield* runtimeModeFor(bot, originKey);
    if (runtime === undefined) return;
    const threadId = yield* ensureRoomThread(roomId, room.title, bot, runtime);
    if (threadId === undefined) {
      yield* systemNote(roomId, `${bot.title} has no model to answer with.`, originKey);
      return;
    }
    const latest = yield* db(store.history({ roomId, limit: 1 }));
    const throughSeq = latest[0]?.seq ?? self.cursorSeq;
    const unseen = yield* db(store.messagesBetween(roomId, self.cursorSeq, throughSeq));
    const names = yield* directory;
    const text = roomDeliveryText({
      roomTitle: room.title,
      botName: bot.title,
      people: participants.flatMap((participant) =>
        participant.participant.kind === "bot"
          ? []
          : [
              {
                name: nameOf(participant.participant, names) ?? "Someone",
                isOwner: participant.participant.kind === "owner",
              },
            ],
      ),
      otherBots: participants.flatMap((participant) =>
        participant.participant.kind === "bot" && participant.key !== botKey
          ? [names.botNames.get(participant.participant.projectId) ?? "a bot"]
          : [],
      ),
      messages: unseen,
      botProjectId: projectId,
      canSeeImages: yield* seesImages(runtime.modelSelection),
    });
    // Files people sent since the bot last spoke come along; its own are already in its thread.
    const seeImages = yield* seesImages(runtime.modelSelection);
    const attachments = unseen.flatMap((message) =>
      message.author.kind === "bot" && message.author.projectId === projectId
        ? []
        : message.attachments.filter((attachment) => seeImages || attachment.type !== "image"),
    );
    const suffix = yield* uuid;
    const sent = yield* db(
      threads.sendToThread({
        projectId,
        threadId,
        commandId: CommandId.make(`room-turn:${suffix}`),
        messageId: MessageId.make(`room-turn:${suffix}`),
        text,
        attachments,
        mode: "queue",
        createdBy: "user",
        creationSource: "server",
      }),
    );
    yield* db(
      store.startTurn(roomId, botKey, {
        runId: sent.run.id,
        hop,
        origin: originKey,
        cursorSeq: throughSeq,
      }),
    );
    yield* emitWorking(roomId);
  });

  /** Gives the bot a turn, or one right after the turn it is in. */
  const requestTurn = (roomId: RoomId, projectId: ProjectId, hop: number, originKey: string) => {
    const botKey = roomParticipantKey({ kind: "bot", projectId });
    return botLocks.withLock(
      `${roomId}|${botKey}`,
      Effect.gen(function* () {
        const self = (yield* participantsOf(roomId)).find(
          (participant) => participant.key === botKey,
        );
        if (self === undefined) return;
        if (self.turnRunId === null) return yield* startTurn(roomId, projectId, hop, originKey);
        const project = yield* db(projects.getById(projectId));
        if (Option.isNone(project)) return;
        const origin =
          self.wantedOrigin === null
            ? originKey
            : yield* leastTrusted(project.value, self.wantedOrigin, originKey);
        yield* db(
          store.setWanted(roomId, botKey, {
            hop: Math.min(self.wantedHop ?? hop, hop),
            origin,
          }),
        );
      }),
    );
  };

  /** One room message and the turns it starts. */
  const deliverMentions = Effect.fn("Rooms.deliverMentions")(function* (
    message: RoomStore.RoomMessageRecord,
    hop: number,
  ) {
    if (message.mentions.length === 0) return;
    if (hop > ROOM_BOT_HOP_LIMIT + 1) {
      yield* systemNote(
        message.roomId,
        "The bots have passed this around enough. @mention one to keep going.",
        message.originKey,
      );
      return;
    }
    yield* Effect.forEach(
      message.mentions,
      (projectId) =>
        requestTurn(message.roomId, projectId, hop, message.originKey).pipe(
          Effect.catch((cause) =>
            Effect.logWarning("Could not start a room turn", { roomId: message.roomId, cause }),
          ),
        ),
      { discard: true, concurrency: "unbounded" },
    );
  });

  const roomOfThread = (threadId: ThreadId) => {
    // `room:<roomId>:<projectId>`; room ids are UUIDs, so the first colon after the prefix splits.
    const rest = threadId.slice("room:".length);
    const split = rest.indexOf(":");
    return split <= 0 ? undefined : RoomId.make(rest.slice(0, split));
  };

  const finishTurn: Rooms["Service"]["finishTurn"] = Effect.fn("Rooms.finishTurn")(
    function* (threadId, run) {
      if (!isRoomThreadId(threadId) || !TERMINAL_RUN_STATUSES.has(run.status)) return;
      const roomId = roomOfThread(threadId);
      if (roomId === undefined) return;
      const shell = yield* db(threads.getThreadShell(threadId));
      if (shell === null) return;
      const projectId = shell.projectId;
      const botKey = roomParticipantKey({ kind: "bot", projectId });
      const next = yield* botLocks.withLock(
        `${roomId}|${botKey}`,
        Effect.gen(function* () {
          const participants = yield* participantsOf(roomId);
          const self = participants.find((participant) => participant.key === botKey);
          if (self === undefined || self.turnRunId !== run.id) return undefined;
          const hop = self.turnHop ?? 1;
          const originKey = self.turnOrigin ?? "owner";
          const records = yield* db(
            threads.getThreadRecords(threadId, ["messages"], {
              messageRoles: ["user", "assistant"],
            }),
          );
          const ofRun = records.messages.filter((message) => message.runId === run.id);
          const reply = ofRun
            .filter((message) => message.role === "assistant" && message.text.trim() !== "")
            .at(-1);
          // Files the bot shared this turn, on its reply or sent into its own thread.
          const shared = ofRun.flatMap((message) =>
            message.role === "assistant" ||
            (message.role === "user" &&
              message.createdBy === "agent" &&
              message.senderThreadId === threadId)
              ? message.attachments
              : [],
          );
          yield* db(store.endTurn(roomId, botKey));
          let posted: RoomStore.RoomMessageRecord | undefined;
          if (reply !== undefined || shared.length > 0) {
            const names = yield* directory;
            posted = yield* appendAndEmit({
              id: RoomMessageId.make(`bot:${reply?.id ?? `${run.id}:files`}`),
              roomId,
              author: { kind: "bot", projectId },
              text: reply?.text ?? "",
              attachments: shared,
              mentions: mentionedBots(
                reply?.text ?? "",
                participants.flatMap((participant) =>
                  participant.participant.kind === "bot" && participant.key !== botKey
                    ? [
                        {
                          projectId: participant.participant.projectId,
                          name: names.botNames.get(participant.participant.projectId) ?? "",
                        },
                      ]
                    : [],
                ),
              ),
              hop,
              originKey,
              sourceMessageId: reply?.id ?? `${run.id}:files`,
            });
          } else if (run.status === "failed") {
            const name = yield* authorNameOf({ kind: "bot", projectId });
            yield* systemNote(roomId, `${name} couldn't answer.`, originKey);
          }
          const wanted =
            self.wantedOrigin === null
              ? undefined
              : { hop: self.wantedHop ?? hop, origin: self.wantedOrigin };
          if (wanted !== undefined) {
            yield* db(store.setWanted(roomId, botKey, null));
            yield* startTurn(roomId, projectId, wanted.hop, wanted.origin);
          }
          yield* emitWorking(roomId);
          return posted === undefined ? undefined : { posted, hop };
        }),
      );
      if (next !== undefined) yield* deliverMentions(next.posted, next.hop + 1);
    },
  );

  const create: Rooms["Service"]["create"] = Effect.fn("Rooms.create")(function* (viewer, input) {
    const memberRows = yield* memberList;
    if (viewer.kind === "member") {
      const me = yield* requireMember(memberRows, viewer.memberId);
      if (!me.canCreateRooms) return yield* notAllowed();
    }
    const people: Array<RoomParticipant> = [viewer];
    for (const memberId of input.memberIds) {
      yield* requireMember(memberRows, memberId);
      if (!people.some((person) => person.kind === "member" && person.memberId === memberId)) {
        people.push({ kind: "member", memberId });
      }
    }
    if (input.includeOwner === true && !isOwner(viewer)) people.push({ kind: "owner" });
    const botParticipants: Array<RoomParticipant> = [];
    for (const projectId of new Set(input.botProjectIds)) {
      yield* requireBotFor(viewer, projectId);
      botParticipants.push({ kind: "bot", projectId });
    }
    const roomId = RoomId.make(yield* uuid);
    yield* db(
      store.insertRoom(
        {
          id: roomId,
          title: input.title,
          createdBy: roomParticipantKey(viewer),
          createdAt: yield* now,
          archivedAt: null,
        },
        [...people, ...botParticipants],
      ),
    );
    yield* listChanged;
    const snapshot = yield* listFor(viewer);
    const summary = snapshot.rooms.find((room) => room.id === roomId);
    if (summary === undefined) return yield* notFound();
    return summary;
  });

  const rename: Rooms["Service"]["rename"] = Effect.fn("Rooms.rename")(
    function* (viewer, roomId, title) {
      yield* requireManager(viewer, roomId);
      yield* db(store.setTitle(roomId, title));
      yield* listChanged;
    },
  );

  const addParticipant: Rooms["Service"]["addParticipant"] = Effect.fn("Rooms.addParticipant")(
    function* (viewer, roomId, participant) {
      yield* requireManager(viewer, roomId);
      yield* requireParticipantAllowed(viewer, participant);
      yield* db(store.addParticipant(roomId, participant, yield* now));
      yield* listChanged;
    },
  );

  /** Stops a bot's turn in the room and forgets it; its thread stays as background work. */
  const dropBot = Effect.fn("Rooms.dropBot")(function* (roomId: RoomId, projectId: ProjectId) {
    const threadId = botRoomThreadId(roomId, projectId);
    yield* threads
      .interruptThread({
        projectId,
        threadId,
        commandId: CommandId.make(`room-left:${yield* uuid}`),
        reason: "The bot was taken out of the room.",
      })
      .pipe(Effect.ignore);
  });

  const removeParticipant: Rooms["Service"]["removeParticipant"] = Effect.fn(
    "Rooms.removeParticipant",
  )(function* (viewer, roomId, participant) {
    yield* requireManager(viewer, roomId);
    yield* db(store.removeParticipant(roomId, roomParticipantKey(participant)));
    if (participant.kind === "bot") yield* dropBot(roomId, participant.projectId);
    yield* emitWorking(roomId);
  });

  const leave: Rooms["Service"]["leave"] = Effect.fn("Rooms.leave")(function* (viewer, roomId) {
    yield* requireJoined(viewer, roomId);
    yield* db(store.removeParticipant(roomId, roomParticipantKey(viewer)));
    yield* emitWorking(roomId);
  });

  const setArchived: Rooms["Service"]["setArchived"] = Effect.fn("Rooms.setArchived")(
    function* (viewer, roomId, archived) {
      yield* requireManager(viewer, roomId);
      yield* db(store.setArchivedAt(roomId, archived ? yield* now : null));
      yield* listChanged;
    },
  );

  const setMuted: Rooms["Service"]["setMuted"] = Effect.fn("Rooms.setMuted")(
    function* (viewer, roomId, muted) {
      yield* requireJoined(viewer, roomId);
      yield* db(store.setMuted(roomId, roomParticipantKey(viewer), muted));
      yield* listChanged;
    },
  );

  const remove: Rooms["Service"]["remove"] = Effect.fn("Rooms.remove")(function* (viewer, roomId) {
    yield* requireManager(viewer, roomId);
    const participants = yield* participantsOf(roomId);
    yield* db(store.deleteRoom(roomId));
    for (const participant of participants) {
      if (participant.participant.kind === "bot") {
        yield* dropBot(roomId, participant.participant.projectId);
      }
    }
    yield* emit(roomId, { kind: "working", working: [] });
    yield* listChanged;
  });

  const markRead: Rooms["Service"]["markRead"] = Effect.fn("Rooms.markRead")(
    function* (viewer, roomId, throughSeq) {
      yield* requireJoined(viewer, roomId);
      const moved = yield* db(store.markRead(roomId, roomParticipantKey(viewer), throughSeq));
      if (moved) yield* listChanged;
    },
  );

  const post: Rooms["Service"]["post"] = Effect.fn("Rooms.post")(function* (viewer, input) {
    const { room, participants } = yield* requireJoined(viewer, input.roomId);
    if (room.archivedAt !== null) return yield* notAllowed();
    const inRoom = new Set(
      participants.flatMap((participant) =>
        participant.participant.kind === "bot" ? [participant.participant.projectId] : [],
      ),
    );
    const text = input.text.trim();
    const uploads = input.attachments ?? [];
    if (text === "" && uploads.length === 0) {
      return yield* new RoomsError({ reason: "empty-message" });
    }
    const attachments = yield* attachmentClaims.claim(input.roomId, uploads);
    const stored = yield* appendAndEmit({
      id: input.messageId,
      roomId: input.roomId,
      author: viewer,
      text,
      attachments,
      mentions: [...new Set(input.mentions)].filter((projectId) => inRoom.has(projectId)),
      hop: 0,
      originKey: roomParticipantKey(viewer),
    });
    if (stored === undefined) return;
    // What you write, you have read.
    yield* db(store.markRead(input.roomId, roomParticipantKey(viewer), stored.seq));
    yield* deliverMentions(stored, 1);
  });

  const historyFor = Effect.fn("Rooms.history")(function* (
    roomId: RoomId,
    beforeSeq: number | undefined,
  ) {
    const page = yield* db(store.history({ roomId, beforeSeq, limit: ROOM_HISTORY_PAGE_SIZE + 1 }));
    const hasOlder = page.length > ROOM_HISTORY_PAGE_SIZE;
    return {
      messages: (hasOlder ? page.slice(1) : page).map(
        ({ hop: _hop, originKey: _originKey, ...message }) => message,
      ),
      hasOlder,
    } satisfies RoomsHistory;
  });

  const history: Rooms["Service"]["history"] = Effect.fn("Rooms.historyFor")(
    function* (viewer, input) {
      yield* requireJoined(viewer, input.roomId);
      return yield* historyFor(input.roomId, input.beforeSeq);
    },
  );

  const feed: Rooms["Service"]["feed"] = (viewer, roomId) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const events = yield* PubSub.subscribe(roomEvents);
        yield* requireJoined(viewer, roomId);
        const snapshot: RoomFeedItem = {
          kind: "snapshot",
          history: yield* historyFor(roomId, undefined),
        };
        const viewerKey = roomParticipantKey(viewer);
        // Leaving or being removed ends the feed; any change in the room is a moment to check.
        const stillJoined = participantsOf(roomId).pipe(
          Effect.map((participants) =>
            participants.some((participant) => participant.key === viewerKey),
          ),
          Effect.orElseSucceed(() => false),
        );
        const toFeedItem = (item: RoomEventItem): RoomFeedItem =>
          item.kind === "requests"
            ? { kind: "requests", requests: forViewer(item.requests, viewer) }
            : item;
        const live = Stream.fromSubscription(events).pipe(
          Stream.filter((event) => event.roomId === roomId),
          Stream.mapEffect((event) =>
            stillJoined.pipe(
              Effect.map((joined) =>
                joined ? Option.some(toFeedItem(event.item)) : Option.none(),
              ),
            ),
          ),
          Stream.takeWhile(Option.isSome),
          Stream.map((item) => item.value),
        );
        const opening: ReadonlyArray<RoomFeedItem> = [
          snapshot,
          { kind: "requests", requests: forViewer(pendingByRoom.get(roomId) ?? [], viewer) },
        ];
        return Stream.concat(Stream.fromIterable(opening), live);
      }),
    );

  /**
   * Rereads the bots' waiting approvals and questions in a room. The person whose message started
   * the turn is the one asked; the owner may always answer.
   */
  const refreshRequests = Effect.fn("Rooms.refreshRequests")(function* (roomId: RoomId) {
    const participants = yield* participantsOf(roomId).pipe(Effect.orElseSucceed(() => []));
    const names = yield* directory;
    const requests: Array<PendingRequest> = [];
    for (const participant of participants) {
      if (participant.participant.kind !== "bot") continue;
      const projectId = participant.participant.projectId;
      const threadId = botRoomThreadId(roomId, projectId);
      const records = yield* threads
        .getThreadRecords(threadId, ["runtimeRequests", "turnItems"])
        .pipe(Effect.orElseSucceed(() => undefined));
      if (records === undefined) continue;
      const askedFor =
        RoomStore.parseParticipantKey(participant.turnOrigin ?? "owner") ??
        ({ kind: "owner" } as const);
      const asked: RoomHuman = askedFor.kind === "member" ? askedFor : { kind: "owner" };
      for (const request of records.runtimeRequests) {
        if (request.status !== "pending") continue;
        const item = records.turnItems.find(
          (candidate: OrchestrationV2TurnItem) =>
            (candidate.type === "approval_request" || candidate.type === "user_input_request") &&
            candidate.requestId === request.id,
        );
        const question = item?.type === "user_input_request" ? item : undefined;
        const approval = item?.type === "approval_request" ? item : undefined;
        requests.push({
          projectId,
          botName: names.botNames.get(projectId) ?? "A bot",
          requestId: request.id,
          kind: question !== undefined || request.kind === "user_input" ? "question" : "approval",
          prompt: approval?.prompt ?? approval?.reason ?? null,
          requestKind: approval?.requestKind ?? request.kind,
          questions: question?.questions ?? [],
          askedFor: asked,
          askedForName: nameOf(asked, names) ?? "Someone",
          createdAt: DateTime.formatIso(request.createdAt),
        });
      }
    }
    const previous = pendingByRoom.get(roomId) ?? [];
    if (requests.length === 0) pendingByRoom.delete(roomId);
    else pendingByRoom.set(roomId, requests);
    const changed =
      previous.length !== requests.length ||
      previous.some((request, index) => request.requestId !== requests[index]?.requestId);
    if (!changed) return;
    yield* emit(roomId, { kind: "requests", requests });
    yield* listChanged;
  });

  const respond: Rooms["Service"]["respond"] = Effect.fn("Rooms.respond")(
    function* (viewer, input) {
      yield* requireJoined(viewer, input.roomId);
      const request = (pendingByRoom.get(input.roomId) ?? []).find(
        (candidate) =>
          candidate.requestId === input.requestId && candidate.projectId === input.projectId,
      );
      if (request === undefined) return yield* notFound();
      if (!forViewer([request], viewer)[0]!.canAnswer) {
        return yield* new RoomsError({ reason: "not-yours-to-answer" });
      }
      yield* db(
        threads.dispatch({
          type: "runtime-request.respond",
          commandId: CommandId.make(`room-respond:${yield* uuid}`),
          threadId: botRoomThreadId(input.roomId, input.projectId),
          requestId: input.requestId,
          ...(input.decision === undefined ? {} : { decision: input.decision }),
          ...(input.answers === undefined ? {} : { answers: input.answers }),
        }),
      );
      yield* refreshRequests(input.roomId);
    },
  );

  const roomsOfBot: Rooms["Service"]["roomsOfBot"] = Effect.fn("Rooms.roomsOfBot")(
    function* (projectId) {
      const botKey = roomParticipantKey({ kind: "bot", projectId });
      const [rooms, participants, names] = yield* Effect.all([
        db(store.listRooms),
        db(store.listParticipants()),
        directory,
      ]);
      return rooms.flatMap((room) => {
        const inRoom = participants.filter((participant) => participant.roomId === room.id);
        if (room.archivedAt !== null || !inRoom.some((participant) => participant.key === botKey)) {
          return [];
        }
        const nameFor = (participant: RoomStore.RoomParticipantRecord) =>
          nameOf(participant.participant, names) ?? "Someone";
        return [
          {
            roomId: room.id,
            title: room.title,
            people: inRoom.filter((p) => p.participant.kind !== "bot").map(nameFor),
            bots: inRoom
              .filter((p) => p.participant.kind === "bot" && p.key !== botKey)
              .map(nameFor),
          },
        ];
      });
    },
  );

  const postAsBot: Rooms["Service"]["postAsBot"] = Effect.fn("Rooms.postAsBot")(function* (input) {
    const botKey = roomParticipantKey({ kind: "bot", projectId: input.projectId });
    const room = yield* requireRoom(input.roomId);
    const participants = yield* participantsOf(input.roomId);
    if (room.archivedAt !== null || !participants.some((p) => p.key === botKey)) {
      return yield* notFound();
    }
    const text = input.text.trim();
    if (text === "") return yield* new RoomsError({ reason: "empty-message" });
    const names = yield* directory;
    const stored = yield* appendAndEmit({
      id: RoomMessageId.make(`bot-post:${yield* uuid}`),
      roomId: input.roomId,
      author: { kind: "bot", projectId: input.projectId },
      text,
      attachments: [],
      mentions: mentionedBots(
        text,
        participants.flatMap((participant) =>
          participant.participant.kind === "bot" && participant.key !== botKey
            ? [
                {
                  projectId: participant.participant.projectId,
                  name: names.botNames.get(participant.participant.projectId) ?? "",
                },
              ]
            : [],
        ),
      ),
      hop: 1,
      // A bot speaking on its own acts for the owner whose bot it is.
      originKey: "owner",
    });
    if (stored !== undefined) yield* deliverMentions(stored, 2);
  });

  /** Runs that ended while the server was down still post their replies. */
  const recover = Effect.gen(function* () {
    const participants = yield* db(store.listParticipants());
    for (const participant of participants) {
      if (participant.participant.kind !== "bot" || participant.turnRunId === null) continue;
      const threadId = botRoomThreadId(participant.roomId, participant.participant.projectId);
      const records = yield* threads
        .getThreadRecords(threadId, ["runs"])
        .pipe(Effect.orElseSucceed(() => undefined));
      const run = records?.runs.find((candidate) => candidate.id === participant.turnRunId);
      if (run === undefined) {
        yield* db(store.endTurn(participant.roomId, participant.key));
        continue;
      }
      yield* finishTurn(threadId, run);
    }
    const rooms = yield* db(store.listRooms);
    yield* Effect.forEach(rooms, (room) => refreshRequests(room.id), { discard: true });
  });

  /** Removed members leave every room. */
  const pruneMembers = Effect.fn("Rooms.pruneMembers")(function* (snapshot: {
    readonly members: ReadonlyArray<EnvironmentMember>;
  }) {
    const current = new Set(snapshot.members.map((member) => `member:${member.id}`));
    const participants = yield* db(store.listParticipants());
    const gone = new Set(
      participants.flatMap((participant) =>
        participant.participant.kind === "member" && !current.has(participant.key)
          ? [participant.key]
          : [],
      ),
    );
    for (const key of gone) yield* db(store.removeParticipantEverywhere(key));
    if (gone.size > 0) yield* listChanged;
  });

  const start = Effect.gen(function* () {
    yield* forkParked(
      settings.streamChanges.pipe(
        Stream.map((current) => current.ownerName),
        Stream.changes,
        Stream.drop(1),
        Stream.runForEach(() => listChanged),
      ),
    );
    yield* forkParked(
      recover.pipe(
        Effect.catch((cause) => Effect.logWarning("Could not recover room turns", { cause })),
      ),
    );
    yield* forkParked(
      Stream.runForEach(threads.streamDomainEvents, (event) =>
        event.type === "runtime-request.updated" && isRoomThreadId(event.threadId)
          ? Effect.suspend(() => {
              const roomId = roomOfThread(event.threadId);
              return roomId === undefined ? Effect.void : refreshRequests(roomId);
            }).pipe(
              Effect.catch((cause) =>
                Effect.logWarning("Could not read a room's waiting requests", { cause }),
              ),
            )
          : event.type === "run.updated" && isRoomThreadId(event.threadId)
            ? finishTurn(event.threadId, event.payload).pipe(
                Effect.catch((cause) =>
                  Effect.logWarning("Could not post a room reply", {
                    threadId: event.threadId,
                    cause,
                  }),
                ),
              )
            : Effect.void,
      ),
    );
    yield* forkParked(
      Stream.runForEach(members.subscribe, (snapshot) =>
        pruneMembers(snapshot).pipe(
          Effect.catch((cause) => Effect.logWarning("Could not prune room members", { cause })),
        ),
      ),
    );
  });

  return {
    service: Rooms.of({
      subscribe,
      create,
      rename,
      addParticipant,
      removeParticipant,
      leave,
      setArchived,
      setMuted,
      remove,
      markRead,
      post,
      roomsOfBot,
      postAsBot,
      respond,
      history,
      feed,
      finishTurn,
    }),
    start,
  };
});

export const layer = Layer.effect(
  Rooms,
  make.pipe(
    Effect.tap(({ start }) => start),
    Effect.map(({ service }) => service),
  ),
).pipe(Layer.provideMerge(RoomStore.layer));

/** With the attachment claims that need the server's files; tests swap those for a mock. */
export const layerLive = layer.pipe(Layer.provide(RoomAttachmentClaims.layer));
