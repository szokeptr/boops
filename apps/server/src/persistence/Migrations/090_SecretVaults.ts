import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // Values live in the server secret store under `vault-entry-<id>`; these hold only metadata.
  yield* sql`
    CREATE TABLE secret_vaults (
      vault_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE TABLE secret_vault_bots (
      vault_id TEXT NOT NULL REFERENCES secret_vaults(vault_id) ON DELETE CASCADE,
      project_id TEXT NOT NULL,
      PRIMARY KEY (vault_id, project_id)
    )
  `;
  yield* sql`CREATE INDEX secret_vault_bots_project_idx ON secret_vault_bots(project_id)`;
  yield* sql`
    CREATE TABLE secret_vault_entries (
      entry_id TEXT PRIMARY KEY,
      vault_id TEXT NOT NULL REFERENCES secret_vaults(vault_id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      label TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_used_at TEXT,
      UNIQUE (vault_id, name)
    )
  `;
});
