import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // Credentials live in the server secret store under `connector-<id>`; this holds only metadata.
  yield* sql`
    CREATE TABLE connector_connections (
      connection_id TEXT PRIMARY KEY,
      catalog_id TEXT,
      display_name TEXT NOT NULL,
      url TEXT NOT NULL,
      auth_kind TEXT NOT NULL,
      header_name TEXT,
      server_name TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      status_detail TEXT,
      tool_count INTEGER,
      oauth_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`ALTER TABLE projection_projects ADD COLUMN connection_ids TEXT NOT NULL DEFAULT '[]'`;
  // Connection cards wait on the user like link cards; keep aligned with ProjectionStore.
  yield* sql`DROP INDEX IF EXISTS orchestration_v2_projection_turn_items_waiting_link_idx`;
  yield* sql`
    CREATE INDEX orchestration_v2_projection_turn_items_waiting_link_idx
    ON orchestration_v2_projection_turn_items(thread_id, updated_at DESC, turn_item_id DESC)
    WHERE type IN ('link_request', 'connection_request') AND status = 'waiting'
  `;
});
