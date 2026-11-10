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
  memberSessionSubject,
  mentionedBots,
  MessageId,
  type OrchestrationV2LinkOrigin,
  type OrchestrationV2Run,
  type OrchestrationV2ThreadShell,
  type Project,
  type ProjectId,
  ROOM_APPROVAL_DECISIONS,
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
import * as OrchestrationEventStore from "../persistence/OrchestrationEventStore.ts";
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

/** The turn a room thread runs: who started it, and after how many bot hand-offs. */
interface RoomTurn {
  readonly originKey: string;
  readonly hop: number;
  /** The member's stamp, as her own conversations carry it; undefined for the owner. */
  readonly linkOrigin: OrchestrationV2LinkOrigin | undefined;
}

type WorkThread = Pick<OrchestrationV2ThreadShell, "id" | "lineage">;

/** A waiting request before it is told whether this viewer may answer it. */
type PendingRequest = Omit<RoomPendingRequest, "canAnswer">;

type RoomEventItem =
  | Exclude<RoomFeedItem, { readonly kind: "requests" }>
  | { readonly kind: "requests"; readonly requests: ReadonlyArray<PendingRequest> }
  /** Someone came or went. Feeds follow it in order, so nothing said while out reaches them. */
  | { readonly kind: "membership"; readonly key: string; readonly joined: boolean };

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
    /**
     * Stops a bot's turn in the room and drops the one it was asked for next. Anyone in the room
     * may, as anyone in a group chat may say stop.
     */
    readonly interrupt: (
      viewer: RoomViewer,
      roomId: RoomId,
      projectId: ProjectId,
    ) => Effect.Effect<void, RoomsError>;
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
     * The turn a room thread, or work it started, runs right now. Undefined outside rooms; fails
     * `not-allowed` when that room thread is not running the turn the room recorded, as for a call
     * that outlived its turn.
     */
    readonly turnOf: (thread: WorkThread) => Effect.Effect<RoomTurn | undefined, RoomsError>;
    /**
     * A bot speaking up in a room from one of its threads, such as a routine's. It acts for the
     * human that thread acts for, and its @mentions continue that thread's hand-offs.
     */
    readonly postAsBot: (input: {
      readonly from: WorkThread & Pick<OrchestrationV2ThreadShell, "projectId" | "linkOrigin">;
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
  const applicationEvents = yield* OrchestrationEventStore.OrchestrationEventStore;
  /** Bots' waiting approvals and questions, by room; refreshed when one opens or closes. */
  const pendingByRoom = new Map<RoomId, ReadonlyArray<PendingRequest>>();

  /** Whose room lists a change touches: these participant keys, or everyone's. */
  const listChanges = yield* PubSub.unbounded<ReadonlySet<string> | "everyone">();
  const roomEvents = yield* PubSub.unbounded<RoomEvent>();
  const botLocks = yield* KeyedLock.make<string>();
  const changedFor = (keys: Iterable<string>) =>
    PubSub.publish(listChanges, new Set(keys)).pipe(Effect.asVoid);
  const changedForEveryone = PubSub.publish(listChanges, "everyone").pipe(Effect.asVoid);
  /** Members' names as last read, so a member who was just removed still has one. */
  const knownMemberNames = new Map<string, string>();
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

  /** Takes a participant out, or announces one just added, so the room's feeds follow in order. */
  const setMembership = Effect.fn("Rooms.setMembership")(function* (
    roomId: RoomId,
    key: string,
    joined: boolean,
  ) {
    if (!joined) yield* db(store.removeParticipant(roomId, key));
    yield* emit(roomId, { kind: "membership", key, joined });
  });

  /**
   * Tells the room's people their list changed. With `owner`, the owner too, who sees every room's
   * title and people; `also` for someone who just left it.
   */
  const roomChanged = Effect.fn("Rooms.roomChanged")(function* (
    roomId: RoomId,
    options?: { readonly owner?: boolean; readonly also?: ReadonlyArray<string> },
  ) {
    const keys = (yield* participantsOf(roomId)).map((participant) => participant.key);
    yield* changedFor([
      ...keys,
      ...(options?.owner === true ? ["owner"] : []),
      ...(options?.also ?? []),
    ]);
  });

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
    for (const member of memberRows) knownMemberNames.set(member.id, member.label);
    return {
      ownerName: owner === "" ? OWNER_FALLBACK_NAME : owner,
      ownerNamed: owner !== "",
      memberNames: new Map(memberRows.map((member) => [member.id as string, member.label])),
      botNames: new Map(botRows.map((bot) => [bot.id as string, bot.title])),
    };
  });

  const listFor = Effect.fn("Rooms.list")(function* (viewer: RoomViewer) {
    const [rooms, participants, lastMessages, lastSpoken, names, memberRows] = yield* Effect.all([
      db(store.listRooms),
      db(store.listParticipants()),
      db(store.lastMessages),
      db(store.lastSpoken),
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
        // System notes never make a room unread, nor hide a message that does.
        unread: (() => {
          const last = lastSpoken.get(room.id);
          return (
            mine !== undefined &&
            last !== undefined &&
            last.seq > mine.readSeq &&
            last.authorKey !== viewerKey
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
        const viewerKey = roomParticipantKey(viewer);
        return Stream.concat(
          Stream.fromEffect(listFor(viewer)),
          Stream.fromSubscription(signals).pipe(
            // Changes that piled up while the last list was read make one new read, and only
            // changes in this viewer's rooms count.
            Stream.chunks,
            Stream.filter((batch) =>
              batch.some((keys) => keys === "everyone" || keys.has(viewerKey)),
            ),
            Stream.mapEffect(() => listFor(viewer)),
          ),
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
    yield* roomChanged(stored.roomId);
    // System notes are the room talking about itself: they never reach phones.
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
    yield* roomChanged(roomId);
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
    if (isRuntimeModeAbove(modeA.mode, modeB.mode)) return b;
    if (isRuntimeModeAbove(modeB.mode, modeA.mode)) return a;
    // At the same mode a member still reaches less than the owner: the tool fence is hers.
    return a === "owner" ? b : a;
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

  /** Says in the room that a bot could not take the turn it was asked for. */
  const cannotAnswer = Effect.fn("Rooms.cannotAnswer")(function* (
    roomId: RoomId,
    projectId: ProjectId,
    originKey: string,
  ) {
    const name = yield* authorNameOf({ kind: "bot", projectId });
    yield* systemNote(roomId, `${name} couldn't answer.`, originKey);
  });

  /** Takes a deleted bot out of the room and says so; the caller holds its lock. */
  const leaveDeleted = Effect.fn("Rooms.leaveDeleted")(function* (
    roomId: RoomId,
    projectId: ProjectId,
    originKey: string,
  ) {
    const project = yield* db(projects.getById(projectId, { includeDeleted: true }));
    const name = Option.isSome(project) ? project.value.title : "A bot";
    yield* setMembership(roomId, roomParticipantKey({ kind: "bot", projectId }), false);
    yield* systemNote(roomId, `${name} was deleted, so it left.`, originKey);
  });

  /** Starts the bot's turn now; the caller holds its lock and knows it is idle. */
  const beginTurn = Effect.fn("Rooms.beginTurn")(function* (
    roomId: RoomId,
    projectId: ProjectId,
    hop: number,
    requestedOrigin: string,
  ) {
    const botKey = roomParticipantKey({ kind: "bot", projectId });
    const room = yield* requireRoom(roomId);
    const participants = yield* participantsOf(roomId);
    const self = participants.find((participant) => participant.key === botKey);
    if (self === undefined || room.archivedAt !== null) return;
    const project = yield* db(projects.getById(projectId));
    if (Option.isNone(project) || project.value.deletedAt !== null) {
      yield* leaveDeleted(roomId, projectId, requestedOrigin);
      yield* roomChanged(roomId, { owner: true });
      return;
    }
    const bot = project.value;
    if (bot.archivedAt != null) {
      yield* systemNote(roomId, `${bot.title} is archived, so it can't answer.`, requestedOrigin);
      return;
    }
    // Background work of an earlier turn runs on in the same session, and its tool calls count as
    // whatever turn is current. While it lasts, a new turn gets the lesser of the two humans' trust.
    const existing = yield* threads
      .getThreadShell(botRoomThreadId(roomId, projectId))
      .pipe(Effect.orElseSucceed(() => null));
    const originKey =
      self.turnOrigin !== null &&
      self.turnOrigin !== requestedOrigin &&
      (existing?.pendingBackgroundTasks?.length ?? 0) > 0
        ? yield* leastTrusted(bot, self.turnOrigin, requestedOrigin)
        : requestedOrigin;
    // A member's room keeps a bot only while it is shared with them, unless the owner is there.
    const creator = RoomStore.parseParticipantKey(room.createdBy);
    if (
      creator?.kind === "member" &&
      !participants.some((participant) => participant.key === "owner") &&
      !isSharedWithMember(bot, creator.memberId)
    ) {
      yield* setMembership(roomId, botKey, false);
      yield* systemNote(roomId, `${bot.title} is no longer shared here, so it left.`, originKey);
      yield* roomChanged(roomId, { owner: true });
      return;
    }
    const runtime = yield* runtimeModeFor(bot, originKey);
    if (runtime === undefined) return yield* cannotAnswer(roomId, projectId, originKey);
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

  /** Starts the bot's turn, or says why it couldn't; the caller holds its lock. */
  const startTurn = (roomId: RoomId, projectId: ProjectId, hop: number, originKey: string) =>
    beginTurn(roomId, projectId, hop, originKey).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Could not start a room turn", { roomId, cause }).pipe(
          Effect.andThen(cannotAnswer(roomId, projectId, originKey)),
        ),
      ),
    );

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

  const parseRoomThread = (threadId: ThreadId) => {
    // `room:<roomId>:<projectId>`; room ids are UUIDs, so the first colon after the prefix splits.
    const rest = threadId.slice("room:".length);
    const split = rest.indexOf(":");
    return split <= 0
      ? undefined
      : { roomId: RoomId.make(rest.slice(0, split)), projectId: rest.slice(split + 1) };
  };
  const roomOfThread = (threadId: ThreadId) => parseRoomThread(threadId)?.roomId;

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
    yield* changedFor(
      [...people, ...botParticipants, { kind: "owner" } as const].map(roomParticipantKey),
    );
    const snapshot = yield* listFor(viewer);
    const summary = snapshot.rooms.find((room) => room.id === roomId);
    if (summary === undefined) return yield* notFound();
    return summary;
  });

  /** A room's hidden bot threads, including those of bots that have since left it. */
  const roomThreads = Effect.fn("Rooms.roomThreads")(function* (roomId: RoomId) {
    const prefix = `room:${roomId}:`;
    const all = yield* db(threads.listProjectThreads({ includeSubagents: false }));
    return all.filter((thread) => thread.id.startsWith(prefix));
  });

  const rename: Rooms["Service"]["rename"] = Effect.fn("Rooms.rename")(
    function* (viewer, roomId, title) {
      const room = yield* requireManager(viewer, roomId);
      if (room.title === title) return;
      yield* db(store.setTitle(roomId, title));
      // Background work lists the hidden threads by the room's name.
      for (const thread of yield* roomThreads(roomId)) {
        yield* threads
          .dispatch({
            type: "thread.metadata.update",
            commandId: CommandId.make(`room-rename:${yield* uuid}`),
            threadId: thread.id,
            title,
          })
          .pipe(
            Effect.catch((cause) =>
              Effect.logWarning("Could not retitle a room thread", { threadId: thread.id, cause }),
            ),
          );
      }
      const who = yield* authorNameOf(viewer);
      yield* systemNote(
        roomId,
        `${who} renamed the chat to "${title}".`,
        roomParticipantKey(viewer),
      );
      yield* roomChanged(roomId, { owner: true });
    },
  );

  const addParticipant: Rooms["Service"]["addParticipant"] = Effect.fn("Rooms.addParticipant")(
    function* (viewer, roomId, participant) {
      yield* requireManager(viewer, roomId);
      yield* requireParticipantAllowed(viewer, participant);
      const key = roomParticipantKey(participant);
      if ((yield* participantsOf(roomId)).some((existing) => existing.key === key)) return;
      yield* db(store.addParticipant(roomId, participant, yield* now));
      yield* setMembership(roomId, key, true);
      const [who, whom] = yield* Effect.all([authorNameOf(viewer), authorNameOf(participant)]);
      const self = roomParticipantKey(viewer) === key;
      yield* systemNote(
        roomId,
        self ? `${who} joined.` : `${who} added ${whom}.`,
        roomParticipantKey(viewer),
      );
      yield* roomChanged(roomId, { owner: true });
    },
  );

  /**
   * Ends a bot's turn and drops the one it was asked for next, and tells its run to stop. With
   * `origin`, only what that human started. True when a turn was running.
   */
  const stopBot = Effect.fn("Rooms.stopBot")(function* (
    roomId: RoomId,
    projectId: ProjectId,
    origin: string | undefined,
    reason: string,
  ) {
    const botKey = roomParticipantKey({ kind: "bot", projectId });
    const runId = yield* botLocks.withLock(
      `${roomId}|${botKey}`,
      Effect.gen(function* () {
        const self = (yield* participantsOf(roomId)).find(
          (participant) => participant.key === botKey,
        );
        if (self === undefined) return null;
        if (self.wantedOrigin !== null && (origin === undefined || self.wantedOrigin === origin)) {
          yield* db(store.setWanted(roomId, botKey, null));
        }
        if (self.turnRunId === null || (origin !== undefined && self.turnOrigin !== origin)) {
          return null;
        }
        // Ended here, so the run's late reply is not posted and its late tool calls are refused.
        yield* db(store.endTurn(roomId, botKey));
        return self.turnRunId;
      }),
    );
    if (runId === null) return false;
    yield* threads
      .interruptThread({
        projectId,
        threadId: botRoomThreadId(roomId, projectId),
        runId,
        commandId: CommandId.make(`room-stop:${yield* uuid}`),
        reason,
      })
      .pipe(Effect.ignore);
    return true;
  });

  /**
   * A human who is gone from the room takes their turns with them: nobody would be left to answer
   * the bot, and its work would go on at their access.
   */
  const stopTurnsOf = Effect.fn("Rooms.stopTurnsOf")(function* (
    roomId: RoomId,
    humanKey: string,
    humanName: string,
  ) {
    for (const participant of yield* participantsOf(roomId)) {
      if (participant.participant.kind !== "bot") continue;
      const projectId = participant.participant.projectId;
      const stopped = yield* stopBot(roomId, projectId, humanKey, "Whoever asked left the room.");
      if (!stopped) continue;
      const bot = yield* authorNameOf(participant.participant);
      yield* systemNote(roomId, `${bot} stopped, since ${humanName} left.`, humanKey);
    }
  });

  /** After someone left: the lists, who is working, and what is still waiting on whom. */
  const afterDeparture = Effect.fn("Rooms.afterDeparture")(function* (roomId: RoomId, key: string) {
    yield* roomChanged(roomId, { owner: true, also: [key] });
    yield* emitWorking(roomId);
    yield* refreshRequests(roomId);
  });

  const removeParticipant: Rooms["Service"]["removeParticipant"] = Effect.fn(
    "Rooms.removeParticipant",
  )(function* (viewer, roomId, participant) {
    yield* requireManager(viewer, roomId);
    // The owner leaves on their own; nobody else takes them out.
    if (participant.kind === "owner" && !isOwner(viewer)) return yield* notAllowed();
    const key = roomParticipantKey(participant);
    if (!(yield* participantsOf(roomId)).some((existing) => existing.key === key)) return;
    const [who, whom] = yield* Effect.all([authorNameOf(viewer), authorNameOf(participant)]);
    if (participant.kind === "bot") {
      yield* stopBot(
        roomId,
        participant.projectId,
        undefined,
        "The bot was taken out of the room.",
      );
    }
    yield* setMembership(roomId, key, false);
    yield* systemNote(roomId, `${who} removed ${whom}.`, roomParticipantKey(viewer));
    if (participant.kind !== "bot") yield* stopTurnsOf(roomId, key, whom);
    yield* afterDeparture(roomId, key);
  });

  const leave: Rooms["Service"]["leave"] = Effect.fn("Rooms.leave")(function* (viewer, roomId) {
    yield* requireJoined(viewer, roomId);
    const key = roomParticipantKey(viewer);
    const name = yield* authorNameOf(viewer);
    yield* setMembership(roomId, key, false);
    yield* systemNote(roomId, `${name} left.`, key);
    yield* stopTurnsOf(roomId, key, name);
    yield* afterDeparture(roomId, key);
  });

  const setArchived: Rooms["Service"]["setArchived"] = Effect.fn("Rooms.setArchived")(
    function* (viewer, roomId, archived) {
      yield* requireManager(viewer, roomId);
      yield* db(store.setArchivedAt(roomId, archived ? yield* now : null));
      yield* roomChanged(roomId, { owner: true });
    },
  );

  const setMuted: Rooms["Service"]["setMuted"] = Effect.fn("Rooms.setMuted")(
    function* (viewer, roomId, muted) {
      yield* requireJoined(viewer, roomId);
      yield* db(store.setMuted(roomId, roomParticipantKey(viewer), muted));
      yield* changedFor([roomParticipantKey(viewer)]);
    },
  );

  /**
   * Deletes the room, its hidden bot threads with their files, and the files people sent in it.
   * Bots' replies keep their files in the bot threads, so the room shows them until now.
   */
  const remove: Rooms["Service"]["remove"] = Effect.fn("Rooms.remove")(function* (viewer, roomId) {
    yield* requireManager(viewer, roomId);
    const participants = yield* participantsOf(roomId);
    const latest = yield* db(store.history({ roomId, limit: 1 }));
    const messages = yield* db(store.messagesBetween(roomId, 0, latest[0]?.seq ?? 0));
    const hidden = yield* roomThreads(roomId);
    yield* db(store.deleteRoom(roomId));
    for (const thread of hidden) {
      yield* threads
        .dispatch({
          type: "thread.delete",
          commandId: CommandId.make(`room-delete:${yield* uuid}`),
          threadId: thread.id,
        })
        .pipe(
          Effect.catch((cause) =>
            Effect.logWarning("Could not delete a room thread", { threadId: thread.id, cause }),
          ),
        );
    }
    yield* attachmentClaims.release(
      roomId,
      messages.flatMap((message) => message.attachments),
    );
    pendingByRoom.delete(roomId);
    yield* emit(roomId, { kind: "working", working: [] });
    yield* changedFor([...participants.map((participant) => participant.key), "owner"]);
  });

  const markRead: Rooms["Service"]["markRead"] = Effect.fn("Rooms.markRead")(
    function* (viewer, roomId, throughSeq) {
      yield* requireJoined(viewer, roomId);
      const moved = yield* db(store.markRead(roomId, roomParticipantKey(viewer), throughSeq));
      if (moved) yield* changedFor([roomParticipantKey(viewer)]);
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
        // Out of the room, the feed goes quiet; back in, it starts over with a snapshot. Clients
        // keep one feed per room, so ending it here would leave a stale view after a rejoin.
        const live = Stream.fromSubscription(events).pipe(
          Stream.filter((event) => event.roomId === roomId),
          Stream.mapAccumEffect(
            () => true,
            Effect.fnUntraced(function* (joined: boolean, { item }: RoomEvent) {
              const none: ReadonlyArray<RoomFeedItem> = [];
              if (item.kind === "membership") {
                if (item.key !== viewerKey) return [joined, none] as const;
                if (!item.joined || joined) return [item.joined, none] as const;
                const back: ReadonlyArray<RoomFeedItem> = [
                  { kind: "snapshot", history: yield* historyFor(roomId, undefined) },
                  {
                    kind: "requests",
                    requests: forViewer(pendingByRoom.get(roomId) ?? [], viewer),
                  },
                ];
                return [true, back] as const;
              }
              if (!joined) return [false, none] as const;
              const out: ReadonlyArray<RoomFeedItem> = [
                item.kind === "requests"
                  ? { kind: "requests", requests: forViewer(item.requests, viewer) }
                  : item,
              ];
              return [true, out] as const;
            }),
          ),
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
   * the turn is the one asked; the owner may always answer. A run that is not the room's turn is
   * not the room's to answer: whoever started a turn is in the room while it runs.
   */
  const refreshRequests = Effect.fn("Rooms.refreshRequests")(function* (roomId: RoomId) {
    const participants = yield* participantsOf(roomId).pipe(Effect.orElseSucceed(() => []));
    const names = yield* directory;
    const requests: Array<PendingRequest> = [];
    for (const participant of participants) {
      if (
        participant.participant.kind !== "bot" ||
        participant.turnRunId === null ||
        participant.turnOrigin === null
      ) {
        continue;
      }
      const projectId = participant.participant.projectId;
      const threadId = botRoomThreadId(roomId, projectId);
      const records = yield* threads
        .getThreadRecords(threadId, ["runtimeRequests", "turnItems"])
        .pipe(Effect.orElseSucceed(() => undefined));
      if (records === undefined) continue;
      const askedFor = RoomStore.parseParticipantKey(participant.turnOrigin);
      const asked: RoomHuman = askedFor?.kind === "member" ? askedFor : { kind: "owner" };
      for (const request of records.runtimeRequests) {
        if (request.status !== "pending") continue;
        const item = records.turnItems.find(
          (candidate: OrchestrationV2TurnItem) =>
            (candidate.type === "approval_request" || candidate.type === "user_input_request") &&
            candidate.requestId === request.id,
        );
        const question = item?.type === "user_input_request" ? item : undefined;
        const approval = item?.type === "approval_request" ? item : undefined;
        const options = approval?.options?.filter((option) =>
          ROOM_APPROVAL_DECISIONS.has(option.decision),
        );
        requests.push({
          projectId,
          botName: names.botNames.get(projectId) ?? "A bot",
          requestId: request.id,
          kind: question !== undefined || request.kind === "user_input" ? "question" : "approval",
          prompt: approval?.prompt ?? approval?.reason ?? null,
          requestKind: approval?.requestKind ?? request.kind,
          ...(options === undefined || options.length === 0 ? {} : { options }),
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
    yield* roomChanged(roomId);
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
      // The bot's session outlives this turn; a standing grant would carry into others' turns.
      if (input.decision !== undefined && !ROOM_APPROVAL_DECISIONS.has(input.decision)) {
        return yield* notAllowed();
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

  const interrupt: Rooms["Service"]["interrupt"] = Effect.fn("Rooms.interrupt")(
    function* (viewer, roomId, projectId) {
      const { participants } = yield* requireJoined(viewer, roomId);
      const botKey = roomParticipantKey({ kind: "bot", projectId });
      if (!participants.some((participant) => participant.key === botKey)) {
        return yield* notFound();
      }
      const reason = "Someone in the group chat stopped it.";
      // A run the room did not start, such as background work waking the bot, still holds its
      // thread; stopping that too is the way out.
      const stopped =
        (yield* stopBot(roomId, projectId, undefined, reason)) ||
        (yield* threads
          .interruptThread({
            projectId,
            threadId: botRoomThreadId(roomId, projectId),
            commandId: CommandId.make(`room-stop:${yield* uuid}`),
            reason,
          })
          .pipe(
            Effect.map((result) => result.type === "interrupt_requested"),
            Effect.orElseSucceed(() => false),
          ));
      if (!stopped) return;
      const [who, bot] = yield* Effect.all([
        authorNameOf(viewer),
        authorNameOf({ kind: "bot", projectId }),
      ]);
      yield* systemNote(roomId, `${who} stopped ${bot}.`, roomParticipantKey(viewer));
      yield* emitWorking(roomId);
      yield* refreshRequests(roomId);
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

  const turnOf: Rooms["Service"]["turnOf"] = Effect.fn("Rooms.turnOf")(function* (thread) {
    const roomThreadId = isRoomThreadId(thread.id)
      ? thread.id
      : isRoomThreadId(thread.lineage.rootThreadId)
        ? thread.lineage.rootThreadId
        : undefined;
    if (roomThreadId === undefined) return undefined;
    const parsed = parseRoomThread(roomThreadId);
    if (parsed === undefined) return yield* notAllowed();
    const botKey = `bot:${parsed.projectId}`;
    const self = (yield* participantsOf(parsed.roomId)).find(
      (participant) => participant.key === botKey,
    );
    const roomThread = yield* db(threads.getThreadShell(roomThreadId));
    if (
      self === undefined ||
      self.turnRunId === null ||
      self.turnOrigin === null ||
      roomThread?.activeRunId !== self.turnRunId
    ) {
      return yield* notAllowed();
    }
    const originKey = self.turnOrigin;
    const hop = self.turnHop ?? 1;
    const origin = RoomStore.parseParticipantKey(originKey);
    if (origin?.kind === "owner") return { originKey, hop, linkOrigin: undefined };
    if (origin?.kind !== "member") return yield* notAllowed();
    const member = (yield* memberList).find((candidate) => candidate.id === origin.memberId);
    if (member === undefined) return yield* notAllowed();
    return {
      originKey,
      hop,
      linkOrigin: {
        sessionId: memberSessionSubject(member.id),
        label: member.label,
        access: member.access,
        memberId: member.id,
      },
    };
  });

  const postAsBot: Rooms["Service"]["postAsBot"] = Effect.fn("Rooms.postAsBot")(function* (input) {
    const projectId = input.from.projectId;
    const botKey = roomParticipantKey({ kind: "bot", projectId });
    const room = yield* requireRoom(input.roomId);
    const participants = yield* participantsOf(input.roomId);
    if (room.archivedAt !== null || !participants.some((p) => p.key === botKey)) {
      return yield* notFound();
    }
    const text = input.text.trim();
    if (text === "") return yield* new RoomsError({ reason: "empty-message" });
    const memberId = input.from.linkOrigin?.memberId;
    const turn = memberId === undefined ? yield* turnOf(input.from) : undefined;
    const hop = turn?.hop ?? 1;
    const names = yield* directory;
    const stored = yield* appendAndEmit({
      id: RoomMessageId.make(`bot-post:${yield* uuid}`),
      roomId: input.roomId,
      author: { kind: "bot", projectId },
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
      hop,
      // Outside rooms and members' conversations, a bot acts for the owner whose bot it is.
      originKey:
        memberId === undefined
          ? (turn?.originKey ?? "owner")
          : roomParticipantKey({ kind: "member", memberId }),
    });
    if (stored !== undefined) yield* deliverMentions(stored, hop + 1);
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
        yield* emitWorking(participant.roomId);
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
    for (const key of gone) {
      const name = knownMemberNames.get(key.slice("member:".length)) ?? "Someone";
      for (const participant of participants) {
        if (participant.key !== key) continue;
        const roomId = participant.roomId;
        yield* setMembership(roomId, key, false);
        yield* systemNote(roomId, `${name} left.`, key);
        yield* stopTurnsOf(roomId, key, name);
        yield* emitWorking(roomId);
        yield* refreshRequests(roomId);
      }
    }
    if (gone.size > 0) yield* changedForEveryone;
  });

  /** A deleted bot leaves every room it is in, its turns and waiting requests with it. */
  const botDeleted = Effect.fn("Rooms.botDeleted")(function* (projectId: ProjectId) {
    const botKey = roomParticipantKey({ kind: "bot", projectId });
    const participants = yield* db(store.listParticipants());
    for (const { roomId } of participants.filter((participant) => participant.key === botKey)) {
      yield* stopBot(roomId, projectId, undefined, "The bot was deleted.");
      // A mention racing this may have taken it out already, saying the same.
      const left = yield* botLocks.withLock(
        `${roomId}|${botKey}`,
        Effect.gen(function* () {
          const self = (yield* participantsOf(roomId)).find((entry) => entry.key === botKey);
          if (self === undefined) return false;
          yield* leaveDeleted(roomId, projectId, "owner");
          return true;
        }),
      );
      if (left) yield* afterDeparture(roomId, botKey);
    }
  });

  /** Bots deleted while the server was down, as from the CLI. */
  const pruneDeletedBots = Effect.gen(function* () {
    const participants = yield* db(store.listParticipants());
    const botIds = new Set(
      participants.flatMap((participant) =>
        participant.participant.kind === "bot" ? [participant.participant.projectId] : [],
      ),
    );
    for (const projectId of botIds) {
      const project = yield* db(projects.getById(projectId));
      if (Option.isNone(project) || project.value.deletedAt !== null) {
        yield* botDeleted(projectId);
      }
    }
  });

  const start = Effect.gen(function* () {
    yield* forkParked(
      settings.streamChanges.pipe(
        Stream.map((current) => current.ownerName),
        Stream.changes,
        Stream.drop(1),
        Stream.runForEach(() => changedForEveryone),
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
    // Every way a project is deleted commits `project.deleted`; reacting here covers them all.
    yield* forkParked(
      Stream.unwrap(
        Effect.gen(function* () {
          const after = yield* applicationEvents.latestApplicationSequence;
          yield* pruneDeletedBots.pipe(
            Effect.catch((cause) => Effect.logWarning("Could not prune deleted bots", { cause })),
          );
          return applicationEvents.streamApplicationEvents({ afterSequence: after });
        }),
      ).pipe(
        Stream.runForEach((event) =>
          "type" in event && event.type === "project.deleted"
            ? botDeleted(event.aggregateId).pipe(
                Effect.catch((cause) =>
                  Effect.logWarning("Could not take a deleted bot out of its rooms", { cause }),
                ),
              )
            : Effect.void,
        ),
        Effect.catch((cause) => Effect.logWarning("Stopped watching for deleted bots", { cause })),
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
      turnOf,
      postAsBot,
      respond,
      interrupt,
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
