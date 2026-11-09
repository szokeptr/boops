/**
 * Vaults: named sets of secrets a bot keeps across threads and routines (ADR 0002). The user
 * grants vaults per bot; agents reach entries by name through `request_secret`. Values live in
 * the server secret store under `vault-entry-<id>`; tables and snapshots hold only metadata.
 */
import {
  type ProjectId,
  SecretVaultEntryId,
  SecretVaultError,
  SecretVaultId,
  type SecretVault,
  type SecretVaultEntryName,
  type SecretVaultsCreateInput,
  type SecretVaultsPutEntryInput,
  type SecretVaultsSetBotInput,
  type SecretVaultsSnapshot,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ProjectService from "../project/ProjectService.ts";

interface VaultRow {
  readonly vault_id: string;
  readonly name: string;
  readonly created_at: string;
}
interface GrantRow {
  readonly vault_id: string;
  readonly project_id: string;
}
interface EntryRow {
  readonly entry_id: string;
  readonly vault_id: string;
  readonly name: string;
  readonly label: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly last_used_at: string | null;
}

/** An entry a bot can use, as agents see it. */
export interface BotSecret {
  readonly entryId: SecretVaultEntryId;
  readonly name: SecretVaultEntryName;
  readonly label: string;
  readonly vault: string;
}

export class SecretVaults extends Context.Service<
  SecretVaults,
  {
    readonly snapshot: Effect.Effect<SecretVaultsSnapshot, SecretVaultError>;
    readonly subscribe: Stream.Stream<SecretVaultsSnapshot, SecretVaultError>;
    readonly create: (
      input: SecretVaultsCreateInput,
    ) => Effect.Effect<SecretVaultId, SecretVaultError>;
    readonly rename: (input: {
      readonly vaultId: SecretVaultId;
      readonly name: string;
    }) => Effect.Effect<void, SecretVaultError>;
    readonly remove: (vaultId: SecretVaultId) => Effect.Effect<void, SecretVaultError>;
    readonly setBot: (input: SecretVaultsSetBotInput) => Effect.Effect<void, SecretVaultError>;
    readonly putEntry: (input: SecretVaultsPutEntryInput) => Effect.Effect<void, SecretVaultError>;
    readonly removeEntry: (entryId: SecretVaultEntryId) => Effect.Effect<void, SecretVaultError>;
    /** Entries the bot can use, one per name. */
    readonly forBot: (
      projectId: ProjectId,
    ) => Effect.Effect<ReadonlyArray<BotSecret>, SecretVaultError>;
    /** The value kept under `name` for the bot, marking the entry used. */
    readonly read: (input: {
      readonly projectId: ProjectId;
      readonly name: SecretVaultEntryName;
    }) => Effect.Effect<Option.Option<string>, SecretVaultError>;
    /**
     * Keeps a value for a bot under `name`, replacing an entry of that name in the bot's vaults.
     * `vaultId: null` picks the bot's only vault, or creates one named after the bot when it has
     * none. Returns the vault's name.
     */
    readonly keep: (input: {
      readonly projectId: ProjectId;
      readonly vaultId: SecretVaultId | null;
      readonly name: SecretVaultEntryName;
      readonly label: string;
      readonly value: string;
    }) => Effect.Effect<string, SecretVaultError>;
  }
>()("boops/secrets/SecretVaults") {}

const failWith = (reason: SecretVaultError["reason"]) => (cause: unknown) =>
  new SecretVaultError({ reason, cause });
const persistence = failWith("persistence_failed");

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const store = yield* ServerSecretStore.ServerSecretStore;
  const random = yield* SecureRandom.SecureRandom;
  const projects = yield* ProjectService.ProjectService;

  const changes = yield* PubSub.unbounded<void>();
  const published = PubSub.publish(changes, undefined).pipe(Effect.asVoid);
  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const newId = random.uuidV4();
  const valueName = (entryId: string) => `vault-entry-${entryId}`;

  const snapshot: SecretVaults["Service"]["snapshot"] = Effect.gen(function* () {
    const vaults = yield* sql<VaultRow>`SELECT * FROM secret_vaults ORDER BY created_at, vault_id`;
    const grants = yield* sql<GrantRow>`SELECT * FROM secret_vault_bots ORDER BY project_id`;
    const entries = yield* sql<EntryRow>`SELECT * FROM secret_vault_entries ORDER BY name`;
    return {
      vaults: vaults.map((vault): SecretVault => ({
        id: SecretVaultId.make(vault.vault_id),
        name: vault.name,
        projectIds: grants
          .filter((grant) => grant.vault_id === vault.vault_id)
          .map((grant) => grant.project_id as ProjectId),
        entries: entries
          .filter((entry) => entry.vault_id === vault.vault_id)
          .map((entry) => ({
            id: SecretVaultEntryId.make(entry.entry_id),
            name: entry.name as SecretVaultEntryName,
            label: entry.label,
            createdAt: entry.created_at,
            updatedAt: entry.updated_at,
            lastUsedAt: entry.last_used_at,
          })),
        createdAt: vault.created_at,
      })),
    };
  }).pipe(Effect.mapError(persistence), Effect.withSpan("SecretVaults.snapshot"));

  const subscribe: SecretVaults["Service"]["subscribe"] = Stream.unwrap(
    Effect.gen(function* () {
      // Subscribe before the first read so no change between them is missed.
      const signals = yield* PubSub.subscribe(changes);
      return Stream.concat(
        Stream.fromEffect(snapshot),
        Stream.fromSubscription(signals).pipe(Stream.mapEffect(() => snapshot)),
      );
    }),
  );

  const requireVault = (vaultId: string) =>
    sql<VaultRow>`SELECT * FROM secret_vaults WHERE vault_id = ${vaultId}`.pipe(
      Effect.mapError(persistence),
      Effect.flatMap((rows) =>
        rows[0] === undefined
          ? Effect.fail(new SecretVaultError({ reason: "vault_not_found" }))
          : Effect.succeed(rows[0]),
      ),
    );

  const requireBot = (projectId: ProjectId) =>
    projects.getById(projectId).pipe(
      Effect.mapError(persistence),
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(new SecretVaultError({ reason: "bot_not_found" })),
          onSome: Effect.succeed,
        }),
      ),
    );

  const insertVault = Effect.fn("SecretVaults.insertVault")(function* (
    name: string,
    projectIds: ReadonlyArray<ProjectId>,
  ) {
    const vaultId = SecretVaultId.make(yield* newId);
    const now = yield* nowIso;
    yield* sql
      .withTransaction(
        Effect.gen(function* () {
          yield* sql`
            INSERT INTO secret_vaults (vault_id, name, created_at) VALUES (${vaultId}, ${name}, ${now})
          `;
          for (const projectId of new Set(projectIds)) {
            yield* sql`
              INSERT INTO secret_vault_bots (vault_id, project_id) VALUES (${vaultId}, ${projectId})
            `;
          }
        }),
      )
      .pipe(Effect.mapError(persistence));
    return vaultId;
  });

  const create: SecretVaults["Service"]["create"] = Effect.fn("SecretVaults.create")(
    function* (input) {
      for (const projectId of input.projectIds ?? []) yield* requireBot(projectId);
      const vaultId = yield* insertVault(input.name, input.projectIds ?? []);
      yield* published;
      return vaultId;
    },
  );

  const rename: SecretVaults["Service"]["rename"] = Effect.fn("SecretVaults.rename")(
    function* (input) {
      yield* requireVault(input.vaultId);
      yield* sql`UPDATE secret_vaults SET name = ${input.name} WHERE vault_id = ${input.vaultId}`.pipe(
        Effect.mapError(persistence),
      );
      yield* published;
    },
  );

  // A value left behind is unreachable without its row, so a failed delete only logs.
  const removeValue = (entryId: string) =>
    store
      .remove(valueName(entryId))
      .pipe(
        Effect.catch((error) =>
          Effect.logWarning("Could not delete a vault entry's value", { errorTag: error._tag }),
        ),
      );

  const remove: SecretVaults["Service"]["remove"] = Effect.fn("SecretVaults.remove")(
    function* (vaultId) {
      yield* requireVault(vaultId);
      const entries = yield* sql<Pick<EntryRow, "entry_id">>`
        SELECT entry_id FROM secret_vault_entries WHERE vault_id = ${vaultId}
      `.pipe(Effect.mapError(persistence));
      // Entries and grants go with the vault (ON DELETE CASCADE).
      yield* sql`DELETE FROM secret_vaults WHERE vault_id = ${vaultId}`.pipe(
        Effect.mapError(persistence),
      );
      for (const entry of entries) yield* removeValue(entry.entry_id);
      yield* published;
    },
  );

  const grant = (vaultId: string, projectId: ProjectId) =>
    sql`
      INSERT INTO secret_vault_bots (vault_id, project_id) VALUES (${vaultId}, ${projectId})
      ON CONFLICT DO NOTHING
    `.pipe(Effect.mapError(persistence));

  const setBot: SecretVaults["Service"]["setBot"] = Effect.fn("SecretVaults.setBot")(
    function* (input) {
      yield* requireVault(input.vaultId);
      if (input.enabled) {
        yield* requireBot(input.projectId);
        yield* grant(input.vaultId, input.projectId);
      } else {
        yield* sql`
          DELETE FROM secret_vault_bots
          WHERE vault_id = ${input.vaultId} AND project_id = ${input.projectId}
        `.pipe(Effect.mapError(persistence));
      }
      yield* published;
    },
  );

  /** Stores the value before the row so a listed entry always has one. */
  const upsertEntry = Effect.fn("SecretVaults.upsertEntry")(function* (input: {
    readonly vaultId: string;
    readonly name: string;
    readonly label: string;
    readonly value: string;
  }) {
    const existing = yield* sql<Pick<EntryRow, "entry_id">>`
      SELECT entry_id FROM secret_vault_entries
      WHERE vault_id = ${input.vaultId} AND name = ${input.name}
    `.pipe(Effect.mapError(persistence));
    const now = yield* nowIso;
    const entryId = existing[0]?.entry_id ?? (yield* newId);
    yield* store
      .set(valueName(entryId), new TextEncoder().encode(input.value))
      .pipe(Effect.mapError(failWith("store_failed")));
    if (existing[0] !== undefined) {
      yield* sql`
        UPDATE secret_vault_entries SET label = ${input.label}, updated_at = ${now}
        WHERE entry_id = ${entryId}
      `.pipe(Effect.mapError(persistence));
    } else {
      yield* sql`
        INSERT INTO secret_vault_entries (entry_id, vault_id, name, label, created_at, updated_at)
        VALUES (${entryId}, ${input.vaultId}, ${input.name}, ${input.label}, ${now}, ${now})
      `.pipe(Effect.mapError(persistence));
    }
  });

  const putEntry: SecretVaults["Service"]["putEntry"] = Effect.fn("SecretVaults.putEntry")(
    function* (input) {
      yield* requireVault(input.vaultId);
      yield* upsertEntry(input);
      yield* published;
    },
  );

  const removeEntry: SecretVaults["Service"]["removeEntry"] = Effect.fn("SecretVaults.removeEntry")(
    function* (entryId) {
      const deleted = yield* sql<Pick<EntryRow, "entry_id">>`
      DELETE FROM secret_vault_entries WHERE entry_id = ${entryId} RETURNING entry_id
    `.pipe(Effect.mapError(persistence));
      if (deleted.length === 0) return yield* new SecretVaultError({ reason: "entry_not_found" });
      yield* removeValue(entryId);
      yield* published;
    },
  );

  // The newest entry wins when two of a bot's vaults hold the same name.
  const botEntries = (projectId: ProjectId) =>
    sql<EntryRow & { readonly vault_name: string }>`
      SELECT entry.*, vault.name AS vault_name
      FROM secret_vault_entries entry
      JOIN secret_vaults vault ON vault.vault_id = entry.vault_id
      JOIN secret_vault_bots bot ON bot.vault_id = entry.vault_id
      WHERE bot.project_id = ${projectId}
      ORDER BY entry.updated_at DESC, entry.entry_id
    `.pipe(
      Effect.mapError(persistence),
      Effect.map((rows) => {
        const seen = new Set<string>();
        return rows.filter((row) => !seen.has(row.name) && seen.add(row.name) !== undefined);
      }),
    );

  const forBot: SecretVaults["Service"]["forBot"] = Effect.fn("SecretVaults.forBot")(
    function* (projectId) {
      const rows = yield* botEntries(projectId);
      return rows
        .map((row) => ({
          entryId: SecretVaultEntryId.make(row.entry_id),
          name: row.name as SecretVaultEntryName,
          label: row.label,
          vault: row.vault_name,
        }))
        .toSorted((a, b) => a.name.localeCompare(b.name));
    },
  );

  const read: SecretVaults["Service"]["read"] = Effect.fn("SecretVaults.read")(function* (input) {
    const row = (yield* botEntries(input.projectId)).find((entry) => entry.name === input.name);
    if (row === undefined) return Option.none();
    const bytes = yield* store
      .get(valueName(row.entry_id))
      .pipe(Effect.mapError(failWith("read_failed")));
    if (Option.isNone(bytes)) return Option.none();
    const now = yield* nowIso;
    yield* sql`UPDATE secret_vault_entries SET last_used_at = ${now} WHERE entry_id = ${row.entry_id}`.pipe(
      Effect.mapError(persistence),
    );
    yield* published;
    return Option.some(new TextDecoder().decode(bytes.value));
  });

  const keep: SecretVaults["Service"]["keep"] = Effect.fn("SecretVaults.keep")(function* (input) {
    const bot = yield* requireBot(input.projectId);
    const granted = yield* sql<VaultRow>`
      SELECT vault.* FROM secret_vaults vault
      JOIN secret_vault_bots bot ON bot.vault_id = vault.vault_id
      WHERE bot.project_id = ${input.projectId}
      ORDER BY vault.created_at, vault.vault_id
    `.pipe(Effect.mapError(persistence));
    // Replacing a value keeps it where it was, whichever vault the card names.
    const holder = (yield* botEntries(input.projectId)).find((entry) => entry.name === input.name);
    const vault =
      holder !== undefined
        ? { vault_id: holder.vault_id, name: holder.vault_name }
        : input.vaultId !== null
          ? granted.find((candidate) => candidate.vault_id === input.vaultId)
          : granted.length === 1
            ? granted[0]
            : granted.length === 0
              ? { vault_id: yield* insertVault(bot.title, [input.projectId]), name: bot.title }
              : undefined;
    if (vault === undefined) {
      return yield* new SecretVaultError({
        reason: input.vaultId === null ? "vault_required" : "vault_not_found",
      });
    }
    yield* upsertEntry({
      vaultId: vault.vault_id,
      name: input.name,
      label: input.label,
      value: input.value,
    });
    yield* published;
    return vault.name;
  });

  return SecretVaults.of({
    snapshot,
    subscribe,
    create,
    rename,
    remove,
    setBot,
    putEntry,
    removeEntry,
    forBot,
    read,
    keep,
  });
});

export const layer = Layer.effect(SecretVaults, make);
