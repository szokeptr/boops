import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE projection_projects ADD COLUMN parent_bot_project_id TEXT`;
  yield* sql`ALTER TABLE projection_projects ADD COLUMN can_create_bots_without_asking INTEGER NOT NULL DEFAULT 0`;
});
