/**
 * Connection credentials, status, and OAuth refresh, apart from `Connectors` so session start can
 * refresh without depending on orchestration. A refresh runs once per connection, in this scope:
 * a caller that gives up never cancels it, so a rotated refresh token is always saved.
 */
import { type ConnectorConnection, ConnectorError } from "@t3tools/contracts";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ConnectorOAuth from "./connectorOAuth.ts";

// A token this close to expiry is refreshed before use; one further out is refreshed alongside.
const REFRESH_WAIT_MS = 30 * 1000;
// Refresh this far ahead, or in the last quarter of a shorter lifetime.
const REFRESH_AHEAD_MS = 10 * 60 * 1000;
const SWEEP_INTERVAL = Duration.seconds(30);

/** What the secret store holds for one connection. */
export const StoredCredential = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("oauth"),
    client: ConnectorOAuth.OAuthClient,
    /** Absent after a disconnect that kept the user's own client. */
    tokens: Schema.optionalKey(ConnectorOAuth.OAuthTokens),
  }),
  Schema.Struct({ kind: Schema.Literal("api-key"), apiKey: Schema.String }),
]);
export type StoredCredential = typeof StoredCredential.Type;
const decodeCredential = Schema.decodeUnknownOption(Schema.fromJsonString(StoredCredential));
const encodeCredential = Schema.encodeEffect(Schema.fromJsonString(StoredCredential));
const decodeServerInfo = Schema.decodeUnknownOption(
  Schema.fromJsonString(ConnectorOAuth.OAuthServerInfo),
);

export interface ConnectionRow {
  readonly connection_id: string;
  readonly catalog_id: string | null;
  readonly display_name: string;
  readonly url: string;
  readonly auth_kind: string;
  readonly header_name: string | null;
  readonly server_name: string;
  readonly status: string;
  readonly status_detail: string | null;
  readonly tool_count: number | null;
  readonly oauth_json: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/** The headers a request to the connection's server carries. */
export const credentialHeaders = (
  row: Pick<ConnectionRow, "header_name">,
  credential: StoredCredential | undefined,
): Record<string, string> => {
  if (credential === undefined) return {};
  if (credential.kind === "oauth") {
    return credential.tokens === undefined
      ? {}
      : { authorization: `Bearer ${credential.tokens.accessToken}` };
  }
  const header = row.header_name ?? "Authorization";
  const bare = header.toLowerCase() === "authorization" && !/^\S+\s+\S/.test(credential.apiKey);
  return { [header]: bare ? `Bearer ${credential.apiKey}` : credential.apiKey };
};

const refreshAhead = (tokens: ConnectorOAuth.OAuthTokens) =>
  tokens.issuedAt === undefined || tokens.expiresAt === undefined
    ? REFRESH_AHEAD_MS
    : Math.min(REFRESH_AHEAD_MS, (tokens.expiresAt - tokens.issuedAt) / 4);

const sameHeaders = (left: Readonly<Record<string, string>>, right: Record<string, string>) => {
  const keys = Object.keys(right);
  return keys.length === Object.keys(left).length && keys.every((key) => left[key] === right[key]);
};

type Refresh = Deferred.Deferred<StoredCredential, ConnectorError>;
type Inflight = ReadonlyMap<string, Refresh>;

export const storage = (cause: unknown) => new ConnectorError({ reason: "storage", cause });

export class ConnectorCredentials extends Context.Service<
  ConnectorCredentials,
  {
    readonly read: (
      connectionId: string,
    ) => Effect.Effect<StoredCredential | undefined, ConnectorError>;
    /** Replaces the credential under the connection's lock; `undefined` forgets it. */
    readonly update: (
      connectionId: string,
      change: (current: StoredCredential | undefined) => StoredCredential | undefined,
    ) => Effect.Effect<void, ConnectorError>;
    readonly setStatus: (
      connectionId: string,
      status: ConnectorConnection["status"],
      detail: string | null,
      toolCount?: number,
    ) => Effect.Effect<void, ConnectorError>;
    /** Signals a change to the connections; `changes` carries it to subscribers. */
    readonly publish: Effect.Effect<void>;
    readonly changes: PubSub.PubSub<void>;
    /**
     * Headers for the connection's server. An OAuth token near expiry is refreshed first, or
     * alongside when it still has a while to go. `rejected` are headers the server answered 401
     * to: they are refreshed unless a newer token already replaced them.
     */
    readonly headersFor: (
      row: ConnectionRow,
      options?: { readonly rejected?: Readonly<Record<string, string>> },
    ) => Effect.Effect<Record<string, string>, ConnectorError>;
    /** Refreshes signed-in OAuth connections near expiry (all, or these) and waits. Never fails. */
    readonly refreshDue: (connectionIds?: ReadonlyArray<string>) => Effect.Effect<void>;
  }
>()("boops/connectors/ConnectorCredentials") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const httpClient = yield* HttpClient.HttpClient;
  const scope = yield* Effect.scope;
  const locks = yield* KeyedLock.make<string>();
  const changes = yield* PubSub.unbounded<void>();
  const publish = PubSub.publish(changes, undefined).pipe(Effect.asVoid);
  const inflight = yield* Ref.make<Inflight>(new Map());

  const secretName = (connectionId: string) => `connector-${connectionId}`;
  const read = (connectionId: string) =>
    secrets.get(secretName(connectionId)).pipe(
      Effect.mapError(storage),
      Effect.map((bytes) =>
        Option.isNone(bytes)
          ? undefined
          : Option.getOrUndefined(decodeCredential(new TextDecoder().decode(bytes.value))),
      ),
    );
  const write = (connectionId: string, credential: StoredCredential | undefined) =>
    credential === undefined
      ? secrets.remove(secretName(connectionId)).pipe(Effect.mapError(storage))
      : encodeCredential(credential).pipe(
          Effect.flatMap((json) =>
            secrets.set(secretName(connectionId), new TextEncoder().encode(json)),
          ),
          Effect.mapError(storage),
        );
  const update: ConnectorCredentials["Service"]["update"] = (connectionId, change) =>
    locks.withLock(
      connectionId,
      read(connectionId).pipe(Effect.flatMap((current) => write(connectionId, change(current)))),
    );

  const setStatus: ConnectorCredentials["Service"]["setStatus"] = Effect.fn(
    "ConnectorCredentials.setStatus",
  )(function* (connectionId, status, detail, toolCount) {
    const now = DateTime.formatIso(yield* DateTime.now);
    yield* (
      toolCount === undefined
        ? sql`
              UPDATE connector_connections
              SET status = ${status}, status_detail = ${detail}, updated_at = ${now}
              WHERE connection_id = ${connectionId}
            `
        : sql`
              UPDATE connector_connections
              SET status = ${status}, status_detail = ${detail}, tool_count = ${toolCount},
                updated_at = ${now}
              WHERE connection_id = ${connectionId}
            `
    ).pipe(Effect.mapError(storage));
    yield* publish;
  });

  const readRow = (connectionId: string) =>
    sql<ConnectionRow>`SELECT * FROM connector_connections WHERE connection_id = ${connectionId}`.pipe(
      Effect.mapError(storage),
      Effect.map((rows) => rows[0]),
    );

  const signedOut = (connectionId: string, detail: string) =>
    setStatus(connectionId, "needs_auth", detail).pipe(
      Effect.andThen(Effect.fail(new ConnectorError({ reason: "not_connected" }))),
    );

  /**
   * Under the connection's lock, with the refresh token stored now. `seen` is the access token the
   * caller found stale: if another refresh already replaced it, that one is used.
   */
  const refreshLocked = (connectionId: string, seen: string) =>
    locks.withLock(
      connectionId,
      Effect.gen(function* () {
        const row = yield* readRow(connectionId);
        const credential = yield* read(connectionId);
        if (row === undefined || credential?.kind !== "oauth" || credential.tokens === undefined) {
          return yield* new ConnectorError({ reason: "not_connected" });
        }
        if (credential.tokens.accessToken !== seen) return credential;
        const info = row.oauth_json === null ? Option.none() : decodeServerInfo(row.oauth_json);
        const refreshToken = credential.tokens.refreshToken;
        if (Option.isNone(info) || refreshToken === undefined) {
          yield* Effect.logWarning("Connector sign-in expired: no refresh token", {
            connectionId,
          });
          return yield* signedOut(connectionId, "Sign-in expired");
        }
        const refreshed = yield* ConnectorOAuth.refresh(
          info.value,
          credential.client,
          refreshToken,
        ).pipe(
          Effect.provideService(HttpClient.HttpClient, httpClient),
          Effect.retry({
            times: 2,
            schedule: Schedule.exponential("1 second"),
            while: (error) => error.reason === "unreachable",
          }),
          Effect.result,
        );
        if (refreshed._tag === "Success") {
          const next: StoredCredential = { ...credential, tokens: refreshed.success };
          yield* write(connectionId, next);
          return next;
        }
        const error = refreshed.failure;
        if (error.reason !== "oauth_failed") {
          // Timeouts, network errors and 5xx: still signed in; the next use or sweep retries.
          yield* Effect.logWarning("Connector token refresh failed; will retry", {
            connectionId,
            detail: error.message,
          });
          return yield* error;
        }
        // Another server sharing this secret store may have rotated it under us.
        const latest = yield* read(connectionId);
        if (
          latest?.kind === "oauth" &&
          latest.tokens !== undefined &&
          latest.tokens.refreshToken !== refreshToken
        ) {
          return latest;
        }
        yield* Effect.logWarning("Connector sign-in expired: the server refused the refresh", {
          connectionId,
          detail: error.message,
        });
        return yield* signedOut(connectionId, "Sign-in expired");
      }),
    );

  const refreshShared = (connectionId: string, seen: string) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const candidate = yield* Deferred.make<StoredCredential, ConnectorError>();
        const deferred = yield* Ref.modify(inflight, (current): readonly [Refresh, Inflight] => {
          const existing = current.get(connectionId);
          if (existing !== undefined) return [existing, current];
          return [candidate, new Map([...current, [connectionId, candidate]])];
        });
        if (deferred === candidate) {
          yield* refreshLocked(connectionId, seen).pipe(
            Effect.exit,
            Effect.flatMap((exit) =>
              Ref.update(
                inflight,
                (current) => new Map([...current].filter(([key]) => key !== connectionId)),
              ).pipe(Effect.andThen(Deferred.done(deferred, exit))),
            ),
            Effect.forkIn(scope),
          );
        }
        return yield* restore(Deferred.await(deferred));
      }),
    );

  const headersFor: ConnectorCredentials["Service"]["headersFor"] = Effect.fn(
    "ConnectorCredentials.headersFor",
  )(function* (row, options) {
    if (row.auth_kind === "none") return {};
    const credential = yield* read(row.connection_id);
    if (
      credential === undefined ||
      (credential.kind === "oauth" && credential.tokens === undefined)
    ) {
      yield* setStatus(row.connection_id, "needs_auth", "Sign-in missing");
      return yield* new ConnectorError({ reason: "not_connected" });
    }
    const current = credentialHeaders(row, credential);
    if (credential.kind !== "oauth" || credential.tokens === undefined) return current;
    const tokens = credential.tokens;
    const rejected = options?.rejected;
    if (rejected !== undefined && !sameHeaders(rejected, current)) return current;
    const now = yield* Clock.currentTimeMillis;
    const remaining = tokens.expiresAt === undefined ? Infinity : tokens.expiresAt - now;
    if (rejected === undefined && remaining >= REFRESH_WAIT_MS) {
      if (remaining < refreshAhead(tokens)) {
        yield* refreshShared(row.connection_id, tokens.accessToken).pipe(
          Effect.ignore,
          Effect.forkIn(scope),
        );
      }
      return current;
    }
    return yield* refreshShared(row.connection_id, tokens.accessToken).pipe(
      Effect.map((next) => credentialHeaders(row, next)),
      // A token that hasn't lapsed yet still works while the server is having trouble.
      Effect.catchIf(
        (error) => error.reason === "unreachable" && rejected === undefined && remaining > 0,
        () => Effect.succeed(current),
      ),
    );
  });

  const refreshDue: ConnectorCredentials["Service"]["refreshDue"] = Effect.fn(
    "ConnectorCredentials.refreshDue",
  )(
    function* (connectionIds) {
      const rows = yield* sql<{ readonly connection_id: string }>`
        SELECT connection_id FROM connector_connections
        WHERE auth_kind = 'oauth' AND status != 'needs_auth'
      `;
      const now = yield* Clock.currentTimeMillis;
      yield* Effect.forEach(
        rows.filter((row) => connectionIds?.includes(row.connection_id) ?? true),
        (row) =>
          read(row.connection_id).pipe(
            Effect.flatMap((credential) => {
              const tokens = credential?.kind === "oauth" ? credential.tokens : undefined;
              return tokens?.expiresAt !== undefined &&
                tokens.expiresAt - now < refreshAhead(tokens)
                ? refreshShared(row.connection_id, tokens.accessToken)
                : Effect.void;
            }),
            Effect.ignore,
          ),
        { concurrency: 4, discard: true },
      );
    },
    (effect) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Could not refresh connector sign-ins", { cause }),
        ),
      ),
  );

  yield* refreshDue().pipe(Effect.repeat(Schedule.spaced(SWEEP_INTERVAL)), Effect.forkIn(scope));

  return ConnectorCredentials.of({
    read,
    update,
    setStatus,
    publish,
    changes,
    headersFor,
    refreshDue,
  });
});

export const layer = Layer.effect(ConnectorCredentials, make);
