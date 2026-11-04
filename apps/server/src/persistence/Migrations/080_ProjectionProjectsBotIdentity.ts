import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Null avatar means none chosen; null main thread falls back to the oldest unarchived thread.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE projection_projects ADD COLUMN avatar TEXT`;
  yield* sql`ALTER TABLE projection_projects ADD COLUMN main_thread_id TEXT`;
});
