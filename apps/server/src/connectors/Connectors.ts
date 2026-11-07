/**
 * Connectors: remote MCP servers a bot can use. A connection is signed in once per environment
 * and turned on per bot, by the user only. Credentials live in the server secret store and never
 * leave this server: providers reach connectors through the proxy in ConnectorProxyHttp.ts.
 */
import {
  CommandId,
  CONNECTOR_CALLBACK_PATH,
  type ConnectorCatalogEntry,
  type ConnectorConnection,
  ConnectorConnectionId,
  ConnectorError,
  type ConnectorRequestRef,
  type ConnectorsAddConnectionInput,
  type ConnectorsAnswerRequestInput,
  type ConnectorsAuthorizationResult,
  type ConnectorsDetectAuthResult,
  type ConnectorOAuthClientInput,
  type ConnectorsReauthenticateInput,
  type ConnectorsReauthenticateResult,
  type ConnectorsRenameInput,
  type ConnectorsSetBotConnectionInput,
  type ConnectorsSnapshot,
  type ConnectorsStartOAuthInput,
  type ConnectorTarget,
  MessageId,
  type NodeId,
  type OrchestrationV2Notification,
  type OrchestrationV2TurnItem,
  OrchestratorMcpFailure,
  type OrchestratorMcpListConnectorsResult,
  type OrchestratorMcpRequestConnectionInput,
  type OrchestratorMcpRequestConnectionResult,
  type ProjectId,
  type RunId,
  type ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";
import * as HttpClient from "effect/http/HttpClient";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { CONNECTOR_CATALOG, catalogEntry } from "./connectorCatalog.ts";
import * as ConnectorMcp from "./connectorMcp.ts";
import * as ConnectorOAuth from "./connectorOAuth.ts";

// Long enough to sign in and approve; a flow is single-use either way.
const OAUTH_FLOW_TTL_MS = 15 * 60 * 1000;
// Refresh this long before expiry so a token never lapses mid-request.
const REFRESH_LEEWAY_MS = 60 * 1000;

/** What the secret store holds for one connection. */
const StoredCredential = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("oauth"),
    client: ConnectorOAuth.OAuthClient,
    /** Absent after a disconnect that kept the user's own client. */
    tokens: Schema.optionalKey(ConnectorOAuth.OAuthTokens),
  }),
  Schema.Struct({ kind: Schema.Literal("api-key"), apiKey: Schema.String }),
]);
type StoredCredential = typeof StoredCredential.Type;
const decodeCredential = Schema.decodeUnknownOption(Schema.fromJsonString(StoredCredential));
const decodeClient = Schema.decodeUnknownOption(Schema.fromJsonString(ConnectorOAuth.OAuthClient));
const decodeServerInfo = Schema.decodeUnknownOption(
  Schema.fromJsonString(ConnectorOAuth.OAuthServerInfo),
);
const encodeCredential = Schema.encodeEffect(Schema.fromJsonString(StoredCredential));
const encodeClient = Schema.encodeEffect(Schema.fromJsonString(ConnectorOAuth.OAuthClient));
const encodeServerInfo = Schema.encodeEffect(Schema.fromJsonString(ConnectorOAuth.OAuthServerInfo));

interface ConnectionRow {
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

const toConnection = (row: ConnectionRow): ConnectorConnection => ({
  id: ConnectorConnectionId.make(row.connection_id),
  catalogId: row.catalog_id,
  displayName: row.display_name,
  url: row.url,
  authKind: row.auth_kind as ConnectorConnection["authKind"],
  status: row.status as ConnectorConnection["status"],
  statusDetail: row.status_detail,
  toolCount: row.tool_count,
  serverName: row.server_name,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

interface OAuthFlow {
  readonly connectionId: ConnectorConnectionId;
  /** Absent for a connection signing in again. */
  readonly create?: {
    readonly catalogId: string | null;
    readonly displayName: string;
    readonly url: string;
  };
  readonly info: ConnectorOAuth.OAuthServerInfo;
  readonly client: ConnectorOAuth.OAuthClient;
  readonly redirectUri: string;
  readonly codeVerifier: string;
  readonly forRequest?: ConnectorRequestRef;
  readonly expiresAt: number;
}

/** The headers a request to the connection's server carries. */
const credentialHeaders = (
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

/** `linear_3f9a1c`: readable, stable across renames, safe as any provider's config key. */
const connectorServerName = (input: {
  readonly catalogId: string | null;
  readonly url: string;
  readonly connectionId: string;
}) => {
  const base =
    input.catalogId ??
    (URL.parse(input.url)?.hostname ?? "mcp").replace(/^(mcp|api|www)\./, "").split(".")[0] ??
    "mcp";
  const slug =
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "mcp";
  const suffix = input.connectionId
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 6)
    .toLowerCase();
  return `${slug.slice(0, 17)}_${suffix}`;
};

const sameServer = (left: string, right: string) => {
  const a = URL.parse(left);
  const b = URL.parse(right);
  return (
    a !== null &&
    b !== null &&
    a.origin === b.origin &&
    a.pathname.replace(/\/$/, "") === b.pathname.replace(/\/$/, "")
  );
};

type ConnectionRequestItem = Extract<
  OrchestrationV2TurnItem,
  { readonly type: "connection_request" }
>;

/** Turn item ids are global; scope the key to this thread and provider session. */
const cardId = (threadId: ThreadId, requestNamespace: string, key: string) =>
  TurnItemId.make(
    `turn-item:connection-request:${encodeURIComponent(threadId)}:${encodeURIComponent(requestNamespace)}:${encodeURIComponent(key)}`,
  );

/** What the bot hears when its card closes. */
const outcomeNotice = (
  card: Pick<ConnectionRequestItem, "label">,
  outcome:
    | { readonly status: "connected"; readonly connection: ConnectorConnection }
    | { readonly status: "declined" },
): {
  readonly text: string;
  readonly notification: OrchestrationV2Notification;
} =>
  outcome.status === "connected"
    ? {
        text: `${outcome.connection.displayName} connected; its tools (MCP server ${outcome.connection.serverName}) are available from your next turn.`,
        notification: {
          source: { kind: "background_task" },
          outcome: "completed",
          summary: `Connected ${outcome.connection.displayName}`,
        },
      }
    : {
        text: `The user declined to connect ${card.label}.`,
        notification: {
          source: { kind: "background_task" },
          outcome: "cancelled",
          summary: `Declined to connect ${card.label}`,
        },
      };

const CLIENT_SETUP_NOTE =
  "The user first creates an OAuth client with the provider; the card walks them through it. Tell them so when you ask, and don't retry.";

const mcpFailure = (code: OrchestratorMcpFailure["code"], message: string) =>
  new OrchestratorMcpFailure({ code, message });

const storage = (cause: unknown) => new ConnectorError({ reason: "storage", cause });

export class Connectors extends Context.Service<
  Connectors,
  {
    readonly catalog: ReadonlyArray<ConnectorCatalogEntry>;
    readonly list: Effect.Effect<ConnectorsSnapshot, ConnectorError>;
    /** The connections now, then again after every change. */
    readonly subscribe: Stream.Stream<ConnectorsSnapshot, ConnectorError>;
    readonly detectAuth: (url: string) => Effect.Effect<ConnectorsDetectAuthResult, ConnectorError>;
    readonly startOAuth: (
      input: ConnectorsStartOAuthInput,
    ) => Effect.Effect<ConnectorsAuthorizationResult, ConnectorError>;
    /** The OAuth redirect: exchanges the code and saves the connection. */
    readonly completeOAuth: (input: {
      readonly state: string;
      readonly code?: string;
      readonly error?: string;
    }) => Effect.Effect<ConnectorConnection, ConnectorError>;
    readonly addConnection: (
      input: ConnectorsAddConnectionInput,
    ) => Effect.Effect<ConnectorConnection, ConnectorError>;
    readonly rename: (
      input: ConnectorsRenameInput,
    ) => Effect.Effect<ConnectorConnection, ConnectorError>;
    readonly reauthenticate: (
      input: ConnectorsReauthenticateInput,
    ) => Effect.Effect<ConnectorsReauthenticateResult, ConnectorError>;
    readonly disconnect: (
      connectionId: ConnectorConnectionId,
    ) => Effect.Effect<ConnectorConnection, ConnectorError>;
    readonly remove: (connectionId: ConnectorConnectionId) => Effect.Effect<void, ConnectorError>;
    readonly test: (connectionId: ConnectorConnectionId) => Effect.Effect<number, ConnectorError>;
    readonly setBotConnection: (
      input: ConnectorsSetBotConnectionInput,
    ) => Effect.Effect<void, ConnectorError>;
    readonly answerRequest: (
      input: ConnectorsAnswerRequestInput,
    ) => Effect.Effect<void, ConnectorError>;
    /** `list_connectors` for the calling bot. */
    readonly listForCaller: (
      scope: McpInvocationContext.McpInvocationScope,
    ) => Effect.Effect<OrchestratorMcpListConnectorsResult, OrchestratorMcpFailure>;
    /** `request_connection`: answers at once, showing a card unless it is already usable. */
    readonly requestConnection: (
      scope: McpInvocationContext.McpInvocationScope,
      input: OrchestratorMcpRequestConnectionInput,
    ) => Effect.Effect<OrchestratorMcpRequestConnectionResult, OrchestratorMcpFailure>;
    /**
     * Where the proxy sends a thread's request for `serverName`, with fresh credentials. Fails
     * with `not_enabled` when it is off for the thread's bot, `not_connected` when it needs
     * sign-in, and `credential_missing` when this server holds no credential for it.
     * `forceRefresh` follows an upstream 401.
     */
    readonly upstream: (input: {
      readonly threadId: ThreadId;
      readonly serverName: string;
      readonly forceRefresh?: boolean;
    }) => Effect.Effect<
      {
        readonly connectionId: ConnectorConnectionId;
        readonly url: string;
        readonly headers: Readonly<Record<string, string>>;
      },
      ConnectorError
    >;
    /** The server refused the credentials even after a refresh. */
    readonly markNeedsAuth: (connectionId: ConnectorConnectionId) => Effect.Effect<void>;
  }
>()("boops/connectors/Connectors") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const httpClient = yield* HttpClient.HttpClient;
  const random = yield* SecureRandom.SecureRandom;
  const digest = yield* Digest.Digest;
  const projects = yield* ProjectService.ProjectService;
  const threadManagement = yield* ThreadManagementService.ThreadManagementService;

  const changes = yield* PubSub.unbounded<void>();
  const published = PubSub.publish(changes, undefined).pipe(Effect.asVoid);
  const flows = yield* Ref.make(new Map<string, OAuthFlow>());
  const credentialLocks = yield* KeyedLock.make<string>();
  const projectLocks = yield* KeyedLock.make<string>();
  const cardLocks = yield* KeyedLock.make<string>();
  const withHttp = Effect.provideService(HttpClient.HttpClient, httpClient);

  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const randomToken = (bytes: number) =>
    random.randomBytes(bytes).pipe(Effect.map(Base64Url.encode));

  const readRow = (connectionId: string) =>
    sql<ConnectionRow>`SELECT * FROM connector_connections WHERE connection_id = ${connectionId}`.pipe(
      Effect.mapError(storage),
      Effect.map((rows) => Option.fromNullishOr(rows[0])),
    );
  const requireRow = (connectionId: string) =>
    readRow(connectionId).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(new ConnectorError({ reason: "unknown_connection" })),
          onSome: Effect.succeed,
        }),
      ),
    );
  const readRows = sql<ConnectionRow>`
    SELECT * FROM connector_connections ORDER BY created_at, connection_id
  `.pipe(Effect.mapError(storage));

  const list: Connectors["Service"]["list"] = readRows.pipe(
    Effect.map((rows) => ({ connections: rows.map(toConnection) })),
    Effect.withSpan("Connectors.list"),
  );

  const secretName = (connectionId: string) => `connector-${connectionId}`;
  const readCredential = (connectionId: string) =>
    secrets.get(secretName(connectionId)).pipe(
      Effect.mapError(storage),
      Effect.map((bytes) =>
        Option.isNone(bytes)
          ? undefined
          : Option.getOrUndefined(decodeCredential(new TextDecoder().decode(bytes.value))),
      ),
    );
  const writeCredential = (connectionId: string, credential: StoredCredential) =>
    encodeCredential(credential).pipe(
      Effect.flatMap((json) =>
        secrets.set(secretName(connectionId), new TextEncoder().encode(json)),
      ),
      Effect.mapError(storage),
    );

  const setStatus = Effect.fn("Connectors.setStatus")(function* (
    connectionId: string,
    status: ConnectorConnection["status"],
    detail: string | null,
    toolCount?: number,
  ) {
    const now = yield* nowIso;
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
    yield* published;
  });

  const insertRow = Effect.fn("Connectors.insertRow")(function* (
    row: Omit<ConnectionRow, "created_at" | "updated_at">,
  ) {
    const now = yield* nowIso;
    yield* sql`
        INSERT INTO connector_connections (
          connection_id, catalog_id, display_name, url, auth_kind, header_name, server_name,
          status, status_detail, tool_count, oauth_json, created_at, updated_at
        ) VALUES (
          ${row.connection_id}, ${row.catalog_id}, ${row.display_name}, ${row.url},
          ${row.auth_kind}, ${row.header_name}, ${row.server_name}, ${row.status},
          ${row.status_detail}, ${row.tool_count}, ${row.oauth_json}, ${now}, ${now}
        )
      `.pipe(Effect.mapError(storage));
    yield* published;
    return yield* requireRow(row.connection_id);
  });

  const hasUsableCredential = (
    credential: StoredCredential | undefined,
  ): credential is StoredCredential =>
    credential !== undefined && !(credential.kind === "oauth" && credential.tokens === undefined);
  // A row copied without its secret file would otherwise claim `connected` forever.
  const markCredentialMissing = (row: ConnectionRow) =>
    row.status === "needs_auth"
      ? Effect.void
      : setStatus(row.connection_id, "needs_auth", "No saved sign-in on this server");

  /** Headers for the connection's server, refreshing an OAuth token near (or past) expiry. */
  const headersFor = (row: ConnectionRow, forceRefresh = false) =>
    credentialLocks.withLock(
      row.connection_id,
      Effect.gen(function* () {
        if (row.auth_kind === "none") return {};
        const credential = yield* readCredential(row.connection_id);
        if (!hasUsableCredential(credential)) {
          yield* markCredentialMissing(row);
          return yield* new ConnectorError({ reason: "credential_missing" });
        }
        if (credential.kind !== "oauth") return credentialHeaders(row, credential);
        const now = yield* Clock.currentTimeMillis;
        const expiring =
          credential.tokens?.expiresAt !== undefined &&
          credential.tokens.expiresAt - now < REFRESH_LEEWAY_MS;
        if (!forceRefresh && !expiring) return credentialHeaders(row, credential);
        const info = row.oauth_json === null ? Option.none() : decodeServerInfo(row.oauth_json);
        const refreshToken = credential.tokens?.refreshToken;
        if (Option.isNone(info) || refreshToken === undefined) {
          yield* setStatus(row.connection_id, "needs_auth", "Sign-in expired");
          return yield* new ConnectorError({ reason: "not_connected" });
        }
        const tokens = yield* ConnectorOAuth.refresh(
          info.value,
          credential.client,
          refreshToken,
        ).pipe(
          withHttp,
          Effect.catchTags({
            ConnectorError: (error) =>
              error.reason === "oauth_failed"
                ? setStatus(row.connection_id, "needs_auth", "Sign-in expired").pipe(
                    Effect.andThen(Effect.fail(new ConnectorError({ reason: "not_connected" }))),
                  )
                : Effect.fail(error),
          }),
        );
        const refreshed: StoredCredential = { ...credential, tokens };
        yield* writeCredential(row.connection_id, refreshed);
        return credentialHeaders(row, refreshed);
      }),
    );

  /** Lists the server's tools with its credentials and records the outcome on the connection. */
  const check = Effect.fn("Connectors.check")(function* (row: ConnectionRow) {
    const headers = yield* headersFor(row);
    return yield* ConnectorMcp.countTools(row.url, headers).pipe(
      withHttp,
      Effect.tap((count) => setStatus(row.connection_id, "connected", null, count)),
      Effect.tapError((error) =>
        error.reason === "not_connected"
          ? setStatus(row.connection_id, "needs_auth", "The server refused the credentials")
          : setStatus(row.connection_id, "error", error.message),
      ),
    );
  });

  const test: Connectors["Service"]["test"] = Effect.fn("Connectors.test")(
    function* (connectionId) {
      return yield* check(yield* requireRow(connectionId));
    },
  );

  const resolveTarget = (target: ConnectorTarget) => {
    if ("catalogId" in target) {
      const entry = catalogEntry(target.catalogId);
      return entry === undefined
        ? Effect.fail(new ConnectorError({ reason: "unknown_catalog_entry" }))
        : Effect.succeed({
            catalogId: entry.id as string | null,
            url: entry.url,
            name: entry.name,
            entry: entry as ConnectorCatalogEntry | undefined,
          });
    }
    return Effect.succeed({
      catalogId: null as string | null,
      url: target.url,
      name: ConnectorOAuth.hostOf(target.url),
      entry: undefined as ConnectorCatalogEntry | undefined,
    });
  };

  const detectAuth: Connectors["Service"]["detectAuth"] = Effect.fn("Connectors.detectAuth")(
    function* (url) {
      const probed = yield* ConnectorMcp.probe(url, {}).pipe(withHttp);
      if (probed.status >= 200 && probed.status < 300) return { authKind: "none" } as const;
      if (probed.status !== 401 && probed.status !== 403) {
        return yield* new ConnectorError({
          reason: "unreachable",
          detail: `HTTP ${probed.status}`,
        });
      }
      return yield* ConnectorOAuth.discover(url, probed.challenge).pipe(
        withHttp,
        Effect.as({ authKind: "oauth" } as const),
        Effect.catchTags({
          ConnectorError: (error) =>
            error.reason === "oauth_unsupported"
              ? Effect.succeed({ authKind: "api-key" } as const)
              : Effect.fail(error),
        }),
      );
    },
  );

  /** The newest client the user entered for this authorization server, from any connection. */
  const userClientFor = Effect.fn("Connectors.userClientFor")(function* (issuer: string) {
    for (const row of (yield* readRows).toReversed()) {
      const info = row.oauth_json === null ? Option.none() : decodeServerInfo(row.oauth_json);
      if (Option.isNone(info) || info.value.issuer !== issuer) continue;
      const credential = yield* readCredential(row.connection_id);
      if (credential?.kind === "oauth" && credential.client.userProvided === true) {
        return credential.client;
      }
    }
    return undefined;
  });

  /**
   * A registered client is reused per authorization server and redirect URI. A server without
   * dynamic registration reuses a client the user entered for another connection, or asks.
   */
  const clientFor = Effect.fn("Connectors.clientFor")(function* (
    info: ConnectorOAuth.OAuthServerInfo,
    redirectUri: string,
  ) {
    const registrationEndpoint = info.registrationEndpoint;
    if (registrationEndpoint === undefined) {
      const reused = yield* userClientFor(info.issuer);
      if (reused !== undefined) return reused;
      return yield* new ConnectorError({
        reason: "oauth_client_required",
        detail: ConnectorOAuth.hostOf(info.issuer),
      });
    }
    const key = Hex.encode(
      yield* digest
        .digest(Digest.sha256, new TextEncoder().encode(`${info.issuer}\n${redirectUri}`))
        .pipe(Effect.orDie),
    ).slice(0, 32);
    const name = `connector-client-${key}`;
    const cached = yield* secrets.get(name).pipe(Effect.mapError(storage));
    if (Option.isSome(cached)) {
      const client = decodeClient(new TextDecoder().decode(cached.value));
      if (Option.isSome(client)) return client.value;
    }
    const client = yield* ConnectorOAuth.registerClient(
      { ...info, registrationEndpoint },
      redirectUri,
    ).pipe(withHttp);
    yield* encodeClient(client).pipe(
      Effect.flatMap((json) => secrets.set(name, new TextEncoder().encode(json))),
      Effect.mapError(storage),
    );
    return client;
  });

  const beginOAuth = Effect.fn("Connectors.beginOAuth")(function* (input: {
    readonly connectionId: ConnectorConnectionId;
    readonly url: string;
    readonly entry: ConnectorCatalogEntry | undefined;
    readonly redirectOrigin: string;
    /** A client the user just entered, else the one this connection signed in with before. */
    readonly client: ConnectorOAuthClientInput | ConnectorOAuth.OAuthClient | undefined;
    readonly create?: OAuthFlow["create"];
    readonly forRequest?: ConnectorRequestRef;
  }) {
    const auth = input.entry?.auth.kind === "oauth" ? input.entry.auth : undefined;
    const probed = yield* ConnectorMcp.probe(input.url, {}).pipe(withHttp);
    // Google's servers answer initialize without a token and refuse only tool calls.
    if (probed.status >= 200 && probed.status < 300 && auth === undefined) {
      return yield* new ConnectorError({ reason: "auth_kind_mismatch", detail: "no sign-in" });
    }
    const discovered = yield* ConnectorOAuth.discover(input.url, probed.challenge).pipe(withHttp);
    const info =
      auth?.scopes === undefined ? discovered : { ...discovered, scope: auth.scopes.join(" ") };
    const redirectUri = `${input.redirectOrigin}${CONNECTOR_CALLBACK_PATH}`;
    const client: ConnectorOAuth.OAuthClient =
      input.client === undefined
        ? yield* clientFor(info, redirectUri)
        : { userProvided: true, ...input.client };
    const codeVerifier = yield* randomToken(32);
    const codeChallenge = Base64Url.encode(
      yield* digest
        .digest(Digest.sha256, new TextEncoder().encode(codeVerifier))
        .pipe(Effect.orDie),
    );
    const state = yield* randomToken(32);
    const now = yield* Clock.currentTimeMillis;
    yield* Ref.update(flows, (current) => {
      const next = new Map([...current].filter(([, flow]) => flow.expiresAt > now));
      next.set(state, {
        connectionId: input.connectionId,
        ...(input.create === undefined ? {} : { create: input.create }),
        info,
        client,
        redirectUri,
        codeVerifier,
        ...(input.forRequest === undefined ? {} : { forRequest: input.forRequest }),
        expiresAt: now + OAUTH_FLOW_TTL_MS,
      });
      return next;
    });
    return ConnectorOAuth.authorizationUrl(info, client, {
      redirectUri,
      codeChallenge,
      state,
      ...(auth?.authorizationParams === undefined ? {} : { params: auth.authorizationParams }),
    });
  });

  const newConnectionId = random.uuidV4().pipe(Effect.map(ConnectorConnectionId.make));

  const startOAuth: Connectors["Service"]["startOAuth"] = Effect.fn("Connectors.startOAuth")(
    function* (input) {
      const target = yield* resolveTarget(input.target);
      if (target.entry !== undefined && target.entry.auth.kind !== "oauth") {
        return yield* new ConnectorError({ reason: "auth_kind_mismatch" });
      }
      const connectionId = yield* newConnectionId;
      const authorizationUrl = yield* beginOAuth({
        connectionId,
        url: target.url,
        entry: target.entry,
        redirectOrigin: input.redirectOrigin,
        client: input.client,
        create: {
          catalogId: target.catalogId,
          displayName: input.displayName ?? target.name,
          url: target.url,
        },
        ...(input.forRequest === undefined ? {} : { forRequest: input.forRequest }),
      });
      return { connectionId, authorizationUrl };
    },
  );

  const completeOAuth: Connectors["Service"]["completeOAuth"] = Effect.fn(
    "Connectors.completeOAuth",
  )(function* (input) {
    const now = yield* Clock.currentTimeMillis;
    const flow = yield* Ref.modify(flows, (current) => {
      const found = current.get(input.state);
      const next = new Map(current);
      next.delete(input.state);
      return [found, next] as const;
    });
    if (flow === undefined || flow.expiresAt <= now) {
      return yield* new ConnectorError({ reason: "oauth_failed", detail: "expired" });
    }
    if (input.error !== undefined || input.code === undefined) {
      return yield* new ConnectorError({
        reason: "oauth_failed",
        detail: (input.error ?? "no code").slice(0, 64),
      });
    }
    const tokens = yield* ConnectorOAuth.exchangeCode(flow.info, flow.client, {
      code: input.code,
      codeVerifier: flow.codeVerifier,
      redirectUri: flow.redirectUri,
    }).pipe(withHttp);
    yield* writeCredential(flow.connectionId, { kind: "oauth", client: flow.client, tokens });
    const oauthJson = yield* encodeServerInfo(flow.info).pipe(Effect.mapError(storage));
    let row: ConnectionRow;
    if (flow.create !== undefined) {
      row = yield* insertRow({
        connection_id: flow.connectionId,
        catalog_id: flow.create.catalogId,
        display_name: flow.create.displayName,
        url: flow.create.url,
        auth_kind: "oauth",
        header_name: null,
        server_name: connectorServerName({ ...flow.create, connectionId: flow.connectionId }),
        status: "connected",
        status_detail: null,
        tool_count: null,
        oauth_json: oauthJson,
      });
    } else {
      yield* sql`
        UPDATE connector_connections SET oauth_json = ${oauthJson}
        WHERE connection_id = ${flow.connectionId}
      `.pipe(Effect.mapError(storage));
      yield* setStatus(flow.connectionId, "connected", null);
      row = yield* requireRow(flow.connectionId);
    }
    yield* check(row).pipe(Effect.ignore);
    const connection = toConnection(yield* requireRow(flow.connectionId));
    if (flow.forRequest !== undefined) yield* resolveRequest(flow.forRequest, connection);
    return connection;
  });

  const addConnection: Connectors["Service"]["addConnection"] = Effect.fn(
    "Connectors.addConnection",
  )(function* (input) {
    const target = yield* resolveTarget(input.target);
    const credential = input.credential;
    const catalogAuth = target.entry?.auth;
    if (catalogAuth !== undefined && catalogAuth.kind !== credential.type) {
      return yield* new ConnectorError({ reason: "auth_kind_mismatch" });
    }
    const headerName =
      credential.type === "api-key"
        ? catalogAuth?.kind === "api-key"
          ? catalogAuth.headerName
          : (credential.headerName ?? "Authorization")
        : null;
    const connectionId = yield* newConnectionId;
    const pending: ConnectionRow = {
      connection_id: connectionId,
      catalog_id: target.catalogId,
      display_name: input.displayName ?? target.name,
      url: target.url,
      auth_kind: credential.type,
      header_name: headerName,
      server_name: connectorServerName({ ...target, connectionId }),
      status: "connected",
      status_detail: null,
      tool_count: null,
      oauth_json: null,
      created_at: "",
      updated_at: "",
    };
    const stored: StoredCredential | undefined =
      credential.type === "api-key" ? { kind: "api-key", apiKey: credential.apiKey } : undefined;
    // A key the server refuses is never saved.
    const toolCount = yield* ConnectorMcp.countTools(
      target.url,
      credentialHeaders(pending, stored),
    ).pipe(withHttp);
    if (stored !== undefined) yield* writeCredential(connectionId, stored);
    const { created_at: _created, updated_at: _updated, ...row } = pending;
    const connection = toConnection(yield* insertRow({ ...row, tool_count: toolCount }));
    if (input.forRequest !== undefined) yield* resolveRequest(input.forRequest, connection);
    return connection;
  });

  const rename: Connectors["Service"]["rename"] = Effect.fn("Connectors.rename")(function* (input) {
    yield* requireRow(input.connectionId);
    const now = yield* nowIso;
    yield* sql`
      UPDATE connector_connections SET display_name = ${input.displayName}, updated_at = ${now}
      WHERE connection_id = ${input.connectionId}
    `.pipe(Effect.mapError(storage));
    yield* published;
    return toConnection(yield* requireRow(input.connectionId));
  });

  const reauthenticate: Connectors["Service"]["reauthenticate"] = Effect.fn(
    "Connectors.reauthenticate",
  )(function* (input) {
    const row = yield* requireRow(input.connectionId);
    if (row.auth_kind !== input.credential.type) {
      return yield* new ConnectorError({ reason: "auth_kind_mismatch" });
    }
    if (input.credential.type === "oauth") {
      const stored = yield* readCredential(row.connection_id);
      const ownClient =
        stored?.kind === "oauth" && stored.client.userProvided === true ? stored.client : undefined;
      return {
        authorizationUrl: yield* beginOAuth({
          connectionId: input.connectionId,
          url: row.url,
          entry: row.catalog_id === null ? undefined : catalogEntry(row.catalog_id),
          redirectOrigin: input.credential.redirectOrigin,
          client: input.credential.client ?? ownClient,
          ...(input.forRequest === undefined ? {} : { forRequest: input.forRequest }),
        }),
      };
    }
    const stored: StoredCredential = { kind: "api-key", apiKey: input.credential.apiKey };
    const toolCount = yield* ConnectorMcp.countTools(row.url, credentialHeaders(row, stored)).pipe(
      withHttp,
    );
    yield* writeCredential(row.connection_id, stored);
    yield* setStatus(row.connection_id, "connected", null, toolCount);
    if (input.forRequest !== undefined) {
      yield* resolveRequest(input.forRequest, toConnection(yield* requireRow(row.connection_id)));
    }
    return { authorizationUrl: null };
  });

  const disconnect: Connectors["Service"]["disconnect"] = Effect.fn("Connectors.disconnect")(
    function* (connectionId) {
      const row = yield* requireRow(connectionId);
      yield* credentialLocks.withLock(
        connectionId,
        Effect.gen(function* () {
          const credential = yield* readCredential(connectionId);
          // The user's own client is kept so signing in again doesn't ask for it.
          if (credential?.kind === "oauth" && credential.client.userProvided === true) {
            return yield* writeCredential(connectionId, {
              kind: "oauth",
              client: credential.client,
            });
          }
          yield* secrets.remove(secretName(connectionId)).pipe(Effect.mapError(storage));
        }),
      );
      yield* setStatus(
        connectionId,
        row.auth_kind === "none" ? "connected" : "needs_auth",
        row.auth_kind === "none" ? null : "Disconnected",
      );
      return toConnection(yield* requireRow(connectionId));
    },
  );

  const updateBotConnections = (
    projectId: ProjectId,
    change: (ids: ReadonlyArray<ConnectorConnectionId>) => ReadonlyArray<ConnectorConnectionId>,
  ) =>
    projectLocks.withLock(
      projectId,
      Effect.gen(function* () {
        const project = yield* projects
          .getById(projectId)
          .pipe(Effect.mapError((cause) => new ConnectorError({ reason: "storage", cause })));
        if (Option.isNone(project)) {
          return yield* new ConnectorError({ reason: "unknown_project" });
        }
        const current = project.value.connectionIds ?? [];
        const next = change(current);
        if (next.length === current.length && next.every((id, index) => id === current[index])) {
          return;
        }
        const suffix = yield* random.uuidV4();
        yield* projects
          .update({
            commandId: CommandId.make(`connectors:bot:${projectId}:${suffix}`),
            projectId,
            connectionIds: next,
          })
          .pipe(Effect.mapError((cause) => new ConnectorError({ reason: "storage", cause })));
      }),
    );

  const enableForBot = (projectId: ProjectId, connectionId: ConnectorConnectionId) =>
    updateBotConnections(projectId, (ids) =>
      ids.includes(connectionId) ? ids : [...ids, connectionId],
    );

  const setBotConnection: Connectors["Service"]["setBotConnection"] = Effect.fn(
    "Connectors.setBotConnection",
  )(function* (input) {
    if (input.enabled) {
      yield* requireRow(input.connectionId);
      return yield* enableForBot(input.projectId, input.connectionId);
    }
    yield* updateBotConnections(input.projectId, (ids) =>
      ids.filter((id) => id !== input.connectionId),
    );
  });

  const remove: Connectors["Service"]["remove"] = Effect.fn("Connectors.remove")(
    function* (connectionId) {
      yield* requireRow(connectionId);
      const shells = yield* projects
        .listShells()
        .pipe(Effect.mapError((cause) => new ConnectorError({ reason: "storage", cause })));
      for (const shell of shells) {
        if (shell.connectionIds?.includes(connectionId) === true) {
          yield* updateBotConnections(shell.id, (ids) => ids.filter((id) => id !== connectionId));
        }
      }
      yield* sql`DELETE FROM connector_connections WHERE connection_id = ${connectionId}`.pipe(
        Effect.mapError(storage),
      );
      yield* credentialLocks.withLock(
        connectionId,
        secrets.remove(secretName(connectionId)).pipe(Effect.mapError(storage)),
      );
      yield* published;
    },
  );

  const projectOfThread = (threadId: ThreadId) =>
    threadManagement
      .getThreadRecords(threadId, [], { messageRoles: [] })
      .pipe(Effect.map((records) => records.thread.projectId));

  const readCard = (threadId: ThreadId, turnItemId: TurnItemId) =>
    threadManagement
      .getThreadRecords(threadId, ["turnItems"], {
        turnItemTypes: ["connection_request"],
        messageRoles: [],
      })
      .pipe(
        Effect.map((records) => {
          const item = records.turnItems.find((candidate) => candidate.id === turnItemId);
          return item?.type === "connection_request" && records.thread.deletedAt === null
            ? item
            : undefined;
        }),
      );

  const recordCard = (
    card: Pick<
      ConnectionRequestItem,
      "id" | "threadId" | "catalogId" | "url" | "label" | "reason"
    > & { readonly runId: RunId; readonly nodeId: NodeId },
    outcome: Pick<ConnectionRequestItem, "connectionStatus" | "connectionId" | "failure">,
    commandId: CommandId,
    wake?: ReturnType<typeof outcomeNotice> & { readonly messageId: MessageId },
  ) =>
    threadManagement.dispatch({
      type: "connection_request.record",
      commandId,
      threadId: card.threadId,
      runId: card.runId,
      nodeId: card.nodeId,
      turnItemId: card.id,
      ...(card.catalogId === undefined ? {} : { catalogId: card.catalogId }),
      ...(card.url === undefined ? {} : { url: card.url }),
      label: card.label,
      reason: card.reason,
      connectionStatus: outcome.connectionStatus,
      ...(outcome.connectionId === undefined ? {} : { connectionId: outcome.connectionId }),
      ...(outcome.failure === undefined ? {} : { failure: outcome.failure }),
      ...(wake === undefined ? {} : { wake }),
    });

  /** Closes a pending card and wakes its bot; a closed or missing card is left as it is. */
  const closeCard = (
    ref: ConnectorRequestRef,
    outcome:
      | { readonly status: "connected"; readonly connection: ConnectorConnection }
      | { readonly status: "declined" },
  ) =>
    cardLocks.withLock(
      ref.turnItemId,
      Effect.gen(function* () {
        const card = yield* readCard(ref.threadId, ref.turnItemId).pipe(
          Effect.mapError((cause) => new ConnectorError({ reason: "storage", cause })),
        );
        if (card === undefined || card.runId === null || card.nodeId === null) {
          return yield* new ConnectorError({ reason: "request_not_found" });
        }
        if (card.connectionStatus !== "pending") {
          return yield* new ConnectorError({ reason: "request_already_answered" });
        }
        yield* recordCard(
          { ...card, runId: card.runId, nodeId: card.nodeId },
          outcome.status === "connected"
            ? { connectionStatus: "connected", connectionId: outcome.connection.id }
            : { connectionStatus: "declined" },
          CommandId.make(`connection-request:${card.id}:${outcome.status}`),
          {
            messageId: MessageId.make(`message:connection-request:${card.id}`),
            ...outcomeNotice(card, outcome),
          },
        ).pipe(Effect.mapError((cause) => new ConnectorError({ reason: "storage", cause })));
      }),
    );

  /**
   * A connection made from a card is turned on for the card's bot, and the card closes. The
   * connection stands even when the card can't close (answered meanwhile, or deleted).
   */
  const resolveRequest = Effect.fn("Connectors.resolveRequest")(
    function* (ref: ConnectorRequestRef, connection: ConnectorConnection) {
      const projectId = yield* projectOfThread(ref.threadId).pipe(
        Effect.mapError((cause) => new ConnectorError({ reason: "request_not_found", cause })),
      );
      yield* enableForBot(projectId, connection.id);
      if (connection.status === "connected") {
        yield* closeCard(ref, { status: "connected", connection });
      }
    },
    (effect, ref) =>
      effect.pipe(
        Effect.catch((error) =>
          Effect.logWarning("Could not close the connection request", {
            threadId: ref.threadId,
            reason: error.reason,
          }),
        ),
      ),
  );

  const answerRequest: Connectors["Service"]["answerRequest"] = Effect.fn(
    "Connectors.answerRequest",
  )(function* (input) {
    const ref = { threadId: input.threadId, turnItemId: input.turnItemId };
    if (input.answer.type === "decline") {
      return yield* closeCard(ref, { status: "declined" });
    }
    const row = yield* requireRow(input.answer.connectionId);
    if (row.status !== "connected") {
      return yield* new ConnectorError({ reason: "not_connected" });
    }
    const projectId = yield* projectOfThread(input.threadId).pipe(
      Effect.mapError((cause) => new ConnectorError({ reason: "request_not_found", cause })),
    );
    // Check the card first so a stale answer doesn't turn a connection on.
    const card = yield* readCard(input.threadId, input.turnItemId).pipe(
      Effect.mapError((cause) => new ConnectorError({ reason: "storage", cause })),
    );
    if (card === undefined) return yield* new ConnectorError({ reason: "request_not_found" });
    if (card.connectionStatus !== "pending") {
      return yield* new ConnectorError({ reason: "request_already_answered" });
    }
    yield* enableForBot(projectId, row.connection_id as ConnectorConnectionId);
    yield* closeCard(ref, { status: "connected", connection: toConnection(row) });
  });

  const callerBot = Effect.fn("Connectors.callerBot")(function* (
    scope: McpInvocationContext.McpInvocationScope,
    operation: string,
  ) {
    const threadScope = yield* McpInvocationContext.requireThreadScope(scope, operation);
    const threadId = threadScope.thread.threadId;
    const projectId = yield* projectOfThread(threadId).pipe(
      Effect.mapError(() => mcpFailure("thread_not_found", "This thread no longer exists.")),
    );
    const project = yield* projects
      .getById(projectId)
      .pipe(Effect.mapError((error) => mcpFailure("orchestration_error", error.message)));
    return {
      threadScope,
      threadId,
      enabled: new Set<string>(Option.getOrUndefined(project)?.connectionIds ?? []),
    };
  });

  const listForCaller: Connectors["Service"]["listForCaller"] = Effect.fn(
    "Connectors.listForCaller",
  )(function* (scope) {
    const { enabled } = yield* callerBot(scope, "list_connectors");
    const rows = yield* readRows.pipe(
      Effect.mapError((error) => mcpFailure("orchestration_error", error.message)),
    );
    return {
      catalog: CONNECTOR_CATALOG.map((entry) => ({
        catalogId: entry.id,
        name: entry.name,
        description: entry.description,
        ...(entry.auth.kind === "oauth" && entry.auth.clientSetup !== undefined
          ? { setup: CLIENT_SETUP_NOTE }
          : {}),
      })),
      connections: rows.map((row) => ({
        name: row.display_name,
        catalogId: row.catalog_id,
        url: row.url,
        serverName: row.server_name,
        status: enabled.has(row.connection_id)
          ? (row.status as ConnectorConnection["status"])
          : ("not_enabled" as const),
      })),
    };
  });

  const requestConnection: Connectors["Service"]["requestConnection"] = Effect.fn(
    "Connectors.requestConnection",
  )(function* (scope, input) {
    if ((input.catalogId === undefined) === (input.url === undefined)) {
      return yield* mcpFailure("invalid_request", "Pass either catalogId or url.");
    }
    const entry = input.catalogId === undefined ? undefined : catalogEntry(input.catalogId);
    if (input.catalogId !== undefined && entry === undefined) {
      return yield* mcpFailure(
        "invalid_request",
        `${input.catalogId} is not in the catalog; list_connectors shows it.`,
      );
    }
    const url = entry?.url ?? input.url!;
    const { threadScope, threadId, enabled } = yield* callerBot(scope, "request_connection");
    const rows = yield* readRows.pipe(
      Effect.mapError((error) => mcpFailure("orchestration_error", error.message)),
    );
    const unreadable = (error: unknown) =>
      mcpFailure(
        "orchestration_error",
        `Could not record the connection request: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    const candidates = rows.filter(
      (row) =>
        enabled.has(row.connection_id) &&
        row.status === "connected" &&
        (entry === undefined ? sameServer(row.url, url) : row.catalog_id === entry.id),
    );
    for (const row of candidates) {
      if (row.auth_kind !== "none") {
        const credential = yield* readCredential(row.connection_id).pipe(
          Effect.mapError(unreadable),
        );
        if (!hasUsableCredential(credential)) {
          yield* markCredentialMissing(row).pipe(Effect.mapError(unreadable));
          continue;
        }
      }
      return { status: "already_connected", serverName: row.server_name } as const;
    }
    const key = input.clientRequestId ?? (yield* random.uuidV4());
    const turnItemId = cardId(threadId, scope.requestNamespace, key);
    if (input.clientRequestId !== undefined) {
      const existing = yield* readCard(threadId, turnItemId).pipe(Effect.mapError(unreadable));
      if (existing !== undefined) return { status: "card_shown", turnItemId } as const;
    }
    const parent = yield* threadManagement
      .getThreadRecords(threadId, ["runs"], { messageRoles: [] })
      .pipe(Effect.mapError(unreadable));
    const run = ThreadManagementService.latestActiveRun(parent);
    if (
      run === undefined ||
      run.rootNodeId === null ||
      run.providerInstanceId !== threadScope.thread.providerInstanceId
    ) {
      return yield* mcpFailure(
        "parent_not_active",
        "Asking for a connection requires an active run owned by this MCP provider session.",
      );
    }
    yield* recordCard(
      {
        id: turnItemId,
        threadId,
        runId: run.id,
        nodeId: run.rootNodeId,
        ...(entry === undefined ? { url } : { catalogId: entry.id }),
        label: entry?.name ?? ConnectorOAuth.hostOf(url),
        reason: input.reason,
      },
      { connectionStatus: "pending" },
      CommandId.make(
        `command:mcp:${encodeURIComponent(scope.requestNamespace)}:connection-pending:${encodeURIComponent(key)}`,
      ),
    ).pipe(Effect.mapError(unreadable));
    return { status: "card_shown", turnItemId } as const;
  });

  const upstream: Connectors["Service"]["upstream"] = Effect.fn("Connectors.upstream")(
    function* (input) {
      const rows = yield* sql<ConnectionRow>`
        SELECT * FROM connector_connections WHERE server_name = ${input.serverName}
      `.pipe(Effect.mapError(storage));
      const row = rows[0];
      if (row === undefined) return yield* new ConnectorError({ reason: "unknown_connection" });
      const projectId = yield* projectOfThread(input.threadId).pipe(
        Effect.mapError((cause) => new ConnectorError({ reason: "not_connected", cause })),
      );
      const project = yield* projects
        .getById(projectId)
        .pipe(Effect.mapError((cause) => new ConnectorError({ reason: "storage", cause })));
      const enabled =
        Option.getOrUndefined(project)?.connectionIds?.includes(
          row.connection_id as ConnectorConnectionId,
        ) === true;
      if (!enabled) return yield* new ConnectorError({ reason: "not_enabled" });
      if (row.status === "needs_auth") {
        return yield* new ConnectorError({ reason: "not_connected" });
      }
      const headers = yield* headersFor(row, input.forceRefresh === true);
      return {
        connectionId: ConnectorConnectionId.make(row.connection_id),
        url: row.url,
        headers,
      };
    },
  );

  const markNeedsAuth: Connectors["Service"]["markNeedsAuth"] = (connectionId) =>
    setStatus(connectionId, "needs_auth", "The server refused the credentials").pipe(
      Effect.ignore,
      Effect.withSpan("Connectors.markNeedsAuth"),
    );

  const subscribe: Connectors["Service"]["subscribe"] = Stream.unwrap(
    Effect.gen(function* () {
      // Subscribe before the first read so no change between them is missed.
      const signals = yield* PubSub.subscribe(changes);
      return Stream.concat(
        Stream.fromEffect(list),
        Stream.fromSubscription(signals).pipe(Stream.mapEffect(() => list)),
      );
    }),
  );

  return Connectors.of({
    catalog: CONNECTOR_CATALOG,
    list,
    subscribe,
    detectAuth,
    startOAuth,
    completeOAuth,
    addConnection,
    rename,
    reauthenticate,
    disconnect,
    remove,
    test,
    setBotConnection,
    answerRequest,
    listForCaller,
    requestConnection,
    upstream,
    markNeedsAuth,
  });
});

export const layer = Layer.effect(Connectors, make);
