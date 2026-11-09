import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    ALTER TABLE environment_members ADD COLUMN can_create_rooms INTEGER NOT NULL DEFAULT 0
  `;
  // `created_by` is `owner` or `member:<id>`, as `roomParticipantKey` writes it.
  yield* sql`
    CREATE TABLE rooms (
      room_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      archived_at TEXT
    )
  `;
  // For a bot, `cursor_seq` is the last message it was handed; the turn fields describe the one
  // turn its room thread runs at a time, and `wanted_*` a mention that arrived during it.
  yield* sql`
    CREATE TABLE room_participants (
      room_id TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
      participant_key TEXT NOT NULL,
      joined_at TEXT NOT NULL,
      muted INTEGER NOT NULL DEFAULT 0,
      read_seq INTEGER NOT NULL DEFAULT 0,
      cursor_seq INTEGER NOT NULL DEFAULT 0,
      turn_run_id TEXT,
      turn_hop INTEGER,
      turn_origin TEXT,
      wanted_hop INTEGER,
      wanted_origin TEXT,
      PRIMARY KEY (room_id, participant_key)
    )
  `;
  // `source_message_id` is the bot thread message a reply was copied from, so copying is idempotent.
  yield* sql`
    CREATE TABLE room_messages (
      room_id TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      message_id TEXT NOT NULL UNIQUE,
      author_key TEXT NOT NULL,
      author_name TEXT NOT NULL,
      text TEXT NOT NULL,
      mentions_json TEXT NOT NULL DEFAULT '[]',
      attachments_json TEXT NOT NULL DEFAULT '[]',
      hop INTEGER NOT NULL DEFAULT 0,
      origin_key TEXT NOT NULL,
      source_message_id TEXT UNIQUE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (room_id, seq)
    )
  `;
});
