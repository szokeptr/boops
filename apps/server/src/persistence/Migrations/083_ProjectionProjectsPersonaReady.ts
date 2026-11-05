import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // Existing bots read as unhatched until the server checks their home folder at startup.
  yield* sql`ALTER TABLE projection_projects ADD COLUMN persona_ready INTEGER NOT NULL DEFAULT 0`;
});
