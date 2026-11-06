import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // `cloud_user_id` binds on the member's first Connect mint; until then the member is invited.
  yield* sql`
    CREATE TABLE environment_members (
      member_id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      access TEXT NOT NULL,
      cloud_user_id TEXT,
      created_at TEXT NOT NULL,
      last_connected_at TEXT
    )
  `;
  yield* sql`ALTER TABLE projection_projects ADD COLUMN member_ids TEXT NOT NULL DEFAULT '[]'`;
  yield* sql`
    ALTER TABLE projection_projects ADD COLUMN member_connection_ids TEXT NOT NULL DEFAULT '[]'
  `;
});
