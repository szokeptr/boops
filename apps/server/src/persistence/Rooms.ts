import {
  ChatAttachment,
  EnvironmentMemberId,
  ProjectId,
  type RoomAuthor,
  RoomId,
  type RoomMessage,
  RoomMessageId,
  type RoomParticipant,
  roomParticipantKey,
  RunId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import { PersistenceSqlError } from "./Errors.ts";

/** `owner`, `member:<id>`, `bot:<projectId>` or `system`, as `roomParticipantKey` writes them. */
export const parseParticipantKey = (key: string): RoomAuthor | undefined => {
  if (key === "owner" || key === "system") return { kind: key };
  if (key.startsWith("member:")) {
    return { kind: "member", memberId: EnvironmentMemberId.make(key.slice("member:".length)) };
  }
  if (key.startsWith("bot:")) return { kind: "bot", projectId: ProjectId.make(key.slice(4)) };
  return undefined;
};

export interface RoomRecord {
  readonly id: RoomId;
  readonly title: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly archivedAt: string | null;
}

/**
 * For a bot: `turn*` is the one turn its room thread runs; `wanted*` a mention during it.
 * `turnOrigin` outlives its turn, so the next one knows whose work may still be running.
 */
export interface RoomParticipantRecord {
  readonly roomId: RoomId;
  readonly key: string;
  readonly participant: RoomParticipant;
  readonly joinedAt: string;
  readonly muted: boolean;
  /** For a person: the newest message they have seen. */
  readonly readSeq: number;
  readonly cursorSeq: number;
  readonly turnRunId: RunId | null;
  readonly turnHop: number | null;
  readonly turnOrigin: string | null;
  readonly wantedHop: number | null;
  readonly wantedOrigin: string | null;
}

export interface RoomMessageRecord extends RoomMessage {
  readonly hop: number;
  readonly originKey: string;
}

export interface NewRoomMessage {
  readonly id: RoomMessageId;
  readonly roomId: RoomId;
  readonly author: RoomAuthor;
  readonly authorName: string;
  readonly text: string;
  readonly mentions: ReadonlyArray<ProjectId>;
  readonly attachments: ReadonlyArray<ChatAttachment>;
  readonly hop: number;
  readonly originKey: string;
  readonly sourceMessageId?: string;
  readonly createdAt: string;
}

export interface BotTurn {
  readonly runId: RunId;
  readonly hop: number;
  readonly origin: string;
  readonly cursorSeq: number;
}

type Row = Record<string, unknown>;

const toRoom = (row: Row): RoomRecord => ({
  id: RoomId.make(String(row.room_id)),
  title: String(row.title),
  createdBy: String(row.created_by),
  createdAt: String(row.created_at),
  archivedAt: row.archived_at === null ? null : String(row.archived_at),
});

const nullableNumber = (value: unknown) => (value === null ? null : Number(value));
const nullableString = (value: unknown) => (value === null ? null : String(value));

const toParticipant = (row: Row): RoomParticipantRecord | undefined => {
  const participant = parseParticipantKey(String(row.participant_key));
  if (participant === undefined || participant.kind === "system") return undefined;
  return {
    roomId: RoomId.make(String(row.room_id)),
    key: String(row.participant_key),
    participant,
    joinedAt: String(row.joined_at),
    muted: Number(row.muted) === 1,
    readSeq: Number(row.read_seq),
    cursorSeq: Number(row.cursor_seq),
    turnRunId: row.turn_run_id === null ? null : RunId.make(String(row.turn_run_id)),
    turnHop: nullableNumber(row.turn_hop),
    turnOrigin: nullableString(row.turn_origin),
    wantedHop: nullableNumber(row.wanted_hop),
    wantedOrigin: nullableString(row.wanted_origin),
  };
};

const decodeMentions = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(ProjectId)));
const AttachmentsJson = Schema.fromJsonString(Schema.Array(ChatAttachment));
const decodeAttachments = Schema.decodeUnknownEffect(AttachmentsJson);
const encodeAttachments = Schema.encodeEffect(AttachmentsJson);

const toMessage = (
  row: Row,
  mentions: ReadonlyArray<ProjectId>,
  attachments: ReadonlyArray<ChatAttachment>,
): RoomMessageRecord | undefined => {
  const author = parseParticipantKey(String(row.author_key));
  if (author === undefined) return undefined;
  return {
    id: RoomMessageId.make(String(row.message_id)),
    roomId: RoomId.make(String(row.room_id)),
    seq: Number(row.seq),
    author,
    authorName: String(row.author_name),
    text: String(row.text),
    mentions,
    attachments,
    createdAt: String(row.created_at),
    hop: Number(row.hop),
    originKey: String(row.origin_key),
  };
};

const definedOnly = <A>(values: ReadonlyArray<A | undefined>): Array<A> =>
  values.filter((value): value is A => value !== undefined);

export class RoomRepository extends Context.Service<
  RoomRepository,
  {
    readonly listRooms: Effect.Effect<ReadonlyArray<RoomRecord>, PersistenceSqlError>;
    readonly getRoom: (id: RoomId) => Effect.Effect<RoomRecord | undefined, PersistenceSqlError>;
    readonly listParticipants: (
      roomId?: RoomId,
    ) => Effect.Effect<ReadonlyArray<RoomParticipantRecord>, PersistenceSqlError>;
    readonly insertRoom: (
      room: RoomRecord,
      participants: ReadonlyArray<RoomParticipant>,
    ) => Effect.Effect<void, PersistenceSqlError>;
    readonly setTitle: (id: RoomId, title: string) => Effect.Effect<void, PersistenceSqlError>;
    readonly setArchivedAt: (
      id: RoomId,
      archivedAt: string | null,
    ) => Effect.Effect<void, PersistenceSqlError>;
    readonly deleteRoom: (id: RoomId) => Effect.Effect<void, PersistenceSqlError>;
    /** A bot joins with its cursor `BOT_JOIN_BACKLOG` messages back, to catch up on the chat. */
    readonly addParticipant: (
      roomId: RoomId,
      participant: RoomParticipant,
      joinedAt: string,
    ) => Effect.Effect<void, PersistenceSqlError>;
    readonly removeParticipant: (
      roomId: RoomId,
      key: string,
    ) => Effect.Effect<void, PersistenceSqlError>;
    /** Moves a person's read position forward, never back. */
    readonly markRead: (
      roomId: RoomId,
      key: string,
      seq: number,
    ) => Effect.Effect<boolean, PersistenceSqlError>;
    readonly setMuted: (
      roomId: RoomId,
      key: string,
      muted: boolean,
    ) => Effect.Effect<void, PersistenceSqlError>;
    /** Assigns the next seq. None when the id or source message was stored already. */
    readonly appendMessage: (
      message: NewRoomMessage,
    ) => Effect.Effect<RoomMessageRecord | undefined, PersistenceSqlError>;
    /** Up to `limit` messages before `beforeSeq` (or the newest), oldest first. */
    readonly history: (input: {
      readonly roomId: RoomId;
      readonly beforeSeq?: number | undefined;
      readonly limit: number;
    }) => Effect.Effect<ReadonlyArray<RoomMessageRecord>, PersistenceSqlError>;
    readonly messagesBetween: (
      roomId: RoomId,
      afterSeq: number,
      throughSeq: number,
    ) => Effect.Effect<ReadonlyArray<RoomMessageRecord>, PersistenceSqlError>;
    readonly lastMessages: Effect.Effect<
      ReadonlyMap<RoomId, RoomMessageRecord>,
      PersistenceSqlError
    >;
    /** Per room, the newest message someone wrote: system notes left out. */
    readonly lastSpoken: Effect.Effect<
      ReadonlyMap<RoomId, { readonly seq: number; readonly authorKey: string }>,
      PersistenceSqlError
    >;
    readonly startTurn: (
      roomId: RoomId,
      botKey: string,
      turn: BotTurn,
    ) => Effect.Effect<void, PersistenceSqlError>;
    readonly endTurn: (roomId: RoomId, botKey: string) => Effect.Effect<void, PersistenceSqlError>;
    readonly setWanted: (
      roomId: RoomId,
      botKey: string,
      wanted: { readonly hop: number; readonly origin: string } | null,
    ) => Effect.Effect<void, PersistenceSqlError>;
  }
>()("boops/persistence/Rooms/RoomRepository") {}

const BOT_JOIN_BACKLOG = 20;

const MentionsJson = Schema.fromJsonString(Schema.Array(Schema.String));
const encodeMentions = Schema.encodeEffect(MentionsJson);

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const sqlError = (operation: string) => (cause: unknown) =>
    new PersistenceSqlError({ operation: `RoomRepository.${operation}`, cause });

  const nextSeq = Effect.fn("RoomRepository.nextSeq")(function* (roomId: RoomId) {
    const rows = yield* sql<{ readonly seq: number }>`
      SELECT COALESCE(MAX(seq), 0) AS seq FROM room_messages WHERE room_id = ${roomId}
    `;
    return Number(rows[0]?.seq ?? 0);
  });

  const insertParticipant = Effect.fn("RoomRepository.insertParticipant")(function* (
    roomId: RoomId,
    participant: RoomParticipant,
    joinedAt: string,
  ) {
    const cursor =
      participant.kind === "bot" ? Math.max(0, (yield* nextSeq(roomId)) - BOT_JOIN_BACKLOG) : 0;
    yield* sql`
      INSERT OR IGNORE INTO room_participants (room_id, participant_key, joined_at, cursor_seq)
      VALUES (${roomId}, ${roomParticipantKey(participant)}, ${joinedAt}, ${cursor})
    `;
  });

  const listRooms = sql<Row>`SELECT * FROM rooms ORDER BY created_at, room_id`.pipe(
    Effect.map((rows) => rows.map(toRoom)),
    Effect.mapError(sqlError("listRooms")),
    Effect.withSpan("RoomRepository.listRooms"),
  );

  const getRoom = Effect.fn("RoomRepository.getRoom")(
    function* (id: RoomId) {
      const rows = yield* sql<Row>`SELECT * FROM rooms WHERE room_id = ${id}`;
      return rows[0] === undefined ? undefined : toRoom(rows[0]);
    },
    Effect.mapError(sqlError("getRoom")),
  );

  const listParticipants = Effect.fn("RoomRepository.listParticipants")(
    function* (roomId?: RoomId) {
      const rows =
        roomId === undefined
          ? yield* sql<Row>`SELECT * FROM room_participants ORDER BY joined_at, rowid`
          : yield* sql<Row>`
              SELECT * FROM room_participants WHERE room_id = ${roomId}
              ORDER BY joined_at, rowid
            `;
      return definedOnly(rows.map(toParticipant));
    },
    Effect.mapError(sqlError("listParticipants")),
  );

  const insertRoom = Effect.fn("RoomRepository.insertRoom")(
    function* (room: RoomRecord, participants: ReadonlyArray<RoomParticipant>) {
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`
            INSERT INTO rooms (room_id, title, created_by, created_at, archived_at)
            VALUES (${room.id}, ${room.title}, ${room.createdBy}, ${room.createdAt}, NULL)
          `;
          for (const participant of participants) {
            yield* insertParticipant(room.id, participant, room.createdAt);
          }
        }),
      );
    },
    Effect.mapError(sqlError("insertRoom")),
  );

  const setTitle = Effect.fn("RoomRepository.setTitle")(
    function* (id: RoomId, title: string) {
      yield* sql`UPDATE rooms SET title = ${title} WHERE room_id = ${id}`;
    },
    Effect.mapError(sqlError("setTitle")),
  );

  const setArchivedAt = Effect.fn("RoomRepository.setArchivedAt")(
    function* (id: RoomId, archivedAt: string | null) {
      yield* sql`UPDATE rooms SET archived_at = ${archivedAt} WHERE room_id = ${id}`;
    },
    Effect.mapError(sqlError("setArchivedAt")),
  );

  const deleteRoom = Effect.fn("RoomRepository.deleteRoom")(
    function* (id: RoomId) {
      yield* sql`DELETE FROM rooms WHERE room_id = ${id}`;
    },
    Effect.mapError(sqlError("deleteRoom")),
  );

  const addParticipant = Effect.fn("RoomRepository.addParticipant")(
    function* (roomId: RoomId, participant: RoomParticipant, joinedAt: string) {
      yield* sql.withTransaction(insertParticipant(roomId, participant, joinedAt));
    },
    Effect.mapError(sqlError("addParticipant")),
  );

  const removeParticipant = Effect.fn("RoomRepository.removeParticipant")(
    function* (roomId: RoomId, key: string) {
      yield* sql`
        DELETE FROM room_participants WHERE room_id = ${roomId} AND participant_key = ${key}
      `;
    },
    Effect.mapError(sqlError("removeParticipant")),
  );

  const setMuted = Effect.fn("RoomRepository.setMuted")(
    function* (roomId: RoomId, key: string, muted: boolean) {
      yield* sql`
        UPDATE room_participants SET muted = ${muted ? 1 : 0}
        WHERE room_id = ${roomId} AND participant_key = ${key}
      `;
    },
    Effect.mapError(sqlError("setMuted")),
  );

  const markRead = Effect.fn("RoomRepository.markRead")(
    function* (roomId: RoomId, key: string, seq: number) {
      const rows = yield* sql<{ readonly changed: number }>`
        UPDATE room_participants SET read_seq = ${seq}
        WHERE room_id = ${roomId} AND participant_key = ${key} AND read_seq < ${seq}
        RETURNING 1 AS changed
      `;
      return rows.length > 0;
    },
    Effect.mapError(sqlError("markRead")),
  );

  const appendMessage = Effect.fn("RoomRepository.appendMessage")(
    function* (message: NewRoomMessage) {
      const mentionsJson = yield* encodeMentions(message.mentions);
      const attachmentsJson = yield* encodeAttachments(message.attachments);
      const sourceMessageId = message.sourceMessageId ?? null;
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const duplicate = yield* sql<{ readonly found: number }>`
            SELECT 1 AS found FROM room_messages
            WHERE message_id = ${message.id}
              OR (${sourceMessageId} IS NOT NULL AND source_message_id = ${sourceMessageId})
          `;
          if (duplicate.length > 0) return undefined;
          const seq = (yield* nextSeq(message.roomId)) + 1;
          yield* sql`
            INSERT INTO room_messages (
              room_id, seq, message_id, author_key, author_name, text, mentions_json,
              attachments_json, hop, origin_key, source_message_id, created_at
            ) VALUES (
              ${message.roomId}, ${seq}, ${message.id}, ${roomParticipantKey(message.author)},
              ${message.authorName}, ${message.text}, ${mentionsJson}, ${attachmentsJson},
              ${message.hop},
              ${message.originKey}, ${sourceMessageId}, ${message.createdAt}
            )
          `;
          const record: RoomMessageRecord = {
            id: message.id,
            roomId: message.roomId,
            seq,
            author: message.author,
            authorName: message.authorName,
            text: message.text,
            mentions: message.mentions,
            attachments: message.attachments,
            createdAt: message.createdAt,
            hop: message.hop,
            originKey: message.originKey,
          };
          return record;
        }),
      );
    },
    Effect.mapError(sqlError("appendMessage")),
  );

  const decodeMessages = Effect.fn("RoomRepository.decodeMessages")(function* (
    rows: ReadonlyArray<Row>,
  ) {
    const messages: Array<RoomMessageRecord> = [];
    for (const row of rows) {
      const mentions = yield* decodeMentions(String(row.mentions_json));
      const attachments = yield* decodeAttachments(String(row.attachments_json));
      const message = toMessage(row, mentions, attachments);
      if (message !== undefined) messages.push(message);
    }
    return messages;
  });

  const history = Effect.fn("RoomRepository.history")(
    function* (input: {
      readonly roomId: RoomId;
      readonly beforeSeq?: number | undefined;
      readonly limit: number;
    }) {
      const rows =
        input.beforeSeq === undefined
          ? yield* sql<Row>`
              SELECT * FROM room_messages WHERE room_id = ${input.roomId}
              ORDER BY seq DESC LIMIT ${input.limit}
            `
          : yield* sql<Row>`
              SELECT * FROM room_messages WHERE room_id = ${input.roomId} AND seq < ${input.beforeSeq}
              ORDER BY seq DESC LIMIT ${input.limit}
            `;
      return (yield* decodeMessages(rows)).toReversed();
    },
    Effect.mapError(sqlError("history")),
  );

  const messagesBetween = Effect.fn("RoomRepository.messagesBetween")(
    function* (roomId: RoomId, afterSeq: number, throughSeq: number) {
      const rows = yield* sql<Row>`
        SELECT * FROM room_messages
        WHERE room_id = ${roomId} AND seq > ${afterSeq} AND seq <= ${throughSeq}
        ORDER BY seq
      `;
      return yield* decodeMessages(rows);
    },
    Effect.mapError(sqlError("messagesBetween")),
  );

  const lastMessages = Effect.gen(function* () {
    const rows = yield* sql<Row>`
      SELECT m.* FROM room_messages m
      JOIN (SELECT room_id, MAX(seq) AS seq FROM room_messages GROUP BY room_id) last
        ON last.room_id = m.room_id AND last.seq = m.seq
    `;
    const messages = yield* decodeMessages(rows);
    return new Map(messages.map((message) => [message.roomId, message]));
  }).pipe(
    Effect.mapError(sqlError("lastMessages")),
    Effect.withSpan("RoomRepository.lastMessages"),
  );

  const lastSpoken = Effect.gen(function* () {
    const rows = yield* sql<{ room_id: string; seq: number; author_key: string }>`
      SELECT m.room_id, m.seq, m.author_key FROM rooms r
      JOIN room_messages m ON m.room_id = r.room_id AND m.seq = (
        SELECT seq FROM room_messages
        WHERE room_id = r.room_id AND author_key <> 'system'
        ORDER BY seq DESC LIMIT 1
      )
    `;
    return new Map(
      rows.map((row) => [
        RoomId.make(String(row.room_id)),
        { seq: Number(row.seq), authorKey: String(row.author_key) },
      ]),
    );
  }).pipe(Effect.mapError(sqlError("lastSpoken")), Effect.withSpan("RoomRepository.lastSpoken"));

  const startTurn = Effect.fn("RoomRepository.startTurn")(
    function* (roomId: RoomId, botKey: string, turn: BotTurn) {
      yield* sql`
        UPDATE room_participants
        SET turn_run_id = ${turn.runId}, turn_hop = ${turn.hop}, turn_origin = ${turn.origin},
          cursor_seq = ${turn.cursorSeq}
        WHERE room_id = ${roomId} AND participant_key = ${botKey}
      `;
    },
    Effect.mapError(sqlError("startTurn")),
  );

  const endTurn = Effect.fn("RoomRepository.endTurn")(
    function* (roomId: RoomId, botKey: string) {
      yield* sql`
        UPDATE room_participants
        SET turn_run_id = NULL, turn_hop = NULL
        WHERE room_id = ${roomId} AND participant_key = ${botKey}
      `;
    },
    Effect.mapError(sqlError("endTurn")),
  );

  const setWanted = Effect.fn("RoomRepository.setWanted")(
    function* (
      roomId: RoomId,
      botKey: string,
      wanted: { readonly hop: number; readonly origin: string } | null,
    ) {
      yield* sql`
        UPDATE room_participants
        SET wanted_hop = ${wanted?.hop ?? null}, wanted_origin = ${wanted?.origin ?? null}
        WHERE room_id = ${roomId} AND participant_key = ${botKey}
      `;
    },
    Effect.mapError(sqlError("setWanted")),
  );

  return RoomRepository.of({
    listRooms,
    getRoom,
    listParticipants,
    insertRoom,
    setTitle,
    setArchivedAt,
    deleteRoom,
    addParticipant,
    removeParticipant,
    setMuted,
    markRead,
    appendMessage,
    history,
    messagesBetween,
    lastMessages,
    lastSpoken,
    startTurn,
    endTurn,
    setWanted,
  });
});

export const layer = Layer.effect(RoomRepository, make);
