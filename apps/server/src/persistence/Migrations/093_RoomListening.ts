import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // For a bot: `listening` lets it chime in without an @mention, `listens_for` says what about.
  // `turn_ambient` marks a turn nobody asked for, `turn_quiet` one the bot chose to end silently.
  yield* sql`ALTER TABLE room_participants ADD COLUMN listening INTEGER NOT NULL DEFAULT 1`;
  yield* sql`ALTER TABLE room_participants ADD COLUMN listens_for TEXT`;
  yield* sql`ALTER TABLE room_participants ADD COLUMN turn_ambient INTEGER NOT NULL DEFAULT 0`;
  yield* sql`ALTER TABLE room_participants ADD COLUMN turn_quiet INTEGER NOT NULL DEFAULT 0`;
  yield* sql`ALTER TABLE room_participants ADD COLUMN wanted_ambient INTEGER NOT NULL DEFAULT 0`;
});
