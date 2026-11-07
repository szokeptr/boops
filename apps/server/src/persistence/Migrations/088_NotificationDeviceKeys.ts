import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // `audience` is `owner` or a member id; a phone has one key per environment, whoever holds it.
  yield* sql`
    CREATE TABLE notification_device_keys (
      device_id TEXT PRIMARY KEY,
      audience TEXT NOT NULL,
      public_key TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX notification_device_keys_audience_idx ON notification_device_keys(audience)`;
});
