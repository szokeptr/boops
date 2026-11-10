import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // `viewer_key` is `owner` or `member:<id>`; the layout is the `SidebarLayout` contract as JSON.
  yield* sql`
    CREATE TABLE sidebar_layouts (
      viewer_key TEXT PRIMARY KEY,
      layout_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
});
