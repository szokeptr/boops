import * as Schema from "effect/Schema";

import {
  ConnectorConnectionId,
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  TurnItemId,
} from "./baseSchemas.ts";

/**
 * A connector is a remote MCP server (Streamable HTTP). A connection is one signed-in instance of
 * it in this environment, such as "Linear (work)"; a bot uses the connections the user turned on
 * for it. Credentials stay on the server: clients and agents only ever see this metadata.
 */

export const ConnectorCatalogId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(64),
  Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
);
export type ConnectorCatalogId = typeof ConnectorCatalogId.Type;

const ConnectorUrl = TrimmedNonEmptyString.check(
  Schema.isMaxLength(2048),
  Schema.isPattern(/^https?:\/\//i),
);

export const ConnectorAuthKind = Schema.Literals(["oauth", "api-key", "none"]);
export type ConnectorAuthKind = typeof ConnectorAuthKind.Type;

export const ConnectorCatalogAuth = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("oauth") }),
  Schema.Struct({
    kind: Schema.Literal("api-key"),
    /** The request header the key goes in. `Authorization` keys are sent as `Bearer <key>`. */
    headerName: TrimmedNonEmptyString,
    /** Where to get a key, for the input's help text. */
    hint: Schema.String,
  }),
  Schema.Struct({ kind: Schema.Literal("none") }),
]);
export type ConnectorCatalogAuth = typeof ConnectorCatalogAuth.Type;

export const ConnectorCatalogEntry = Schema.Struct({
  id: ConnectorCatalogId,
  name: TrimmedNonEmptyString,
  description: Schema.String,
  url: ConnectorUrl,
  auth: ConnectorCatalogAuth,
  docsUrl: ConnectorUrl,
  /** The service's own icon. Clients fall back to a monogram when it fails to load. */
  iconUrl: ConnectorUrl,
});
export type ConnectorCatalogEntry = typeof ConnectorCatalogEntry.Type;

/**
 * `connected`: credentials work as far as the server knows. `needs_auth`: sign in again (a refresh
 * failed, the server answered 401, or the user disconnected). `error`: the last check failed for
 * another reason; `statusDetail` says why.
 */
export const ConnectorConnectionStatus = Schema.Literals(["connected", "needs_auth", "error"]);
export type ConnectorConnectionStatus = typeof ConnectorConnectionStatus.Type;

export const ConnectorConnection = Schema.Struct({
  id: ConnectorConnectionId,
  /** Null for a server added by URL. */
  catalogId: Schema.NullOr(ConnectorCatalogId),
  displayName: TrimmedNonEmptyString,
  url: ConnectorUrl,
  authKind: ConnectorAuthKind,
  status: ConnectorConnectionStatus,
  /** A short, safe reason for `needs_auth` or `error`. */
  statusDetail: Schema.NullOr(Schema.String),
  /** Tools the server listed at the last successful check. */
  toolCount: Schema.NullOr(NonNegativeInt),
  /** The provider-facing MCP server name bots see this connection under, e.g. `linear_3f9a1c`. */
  serverName: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ConnectorConnection = typeof ConnectorConnection.Type;

export const ConnectorsSnapshot = Schema.Struct({
  connections: Schema.Array(ConnectorConnection),
});
export type ConnectorsSnapshot = typeof ConnectorsSnapshot.Type;

/** A catalog entry, or any remote MCP server by URL. */
export const ConnectorTarget = Schema.Union([
  Schema.Struct({ catalogId: ConnectorCatalogId }),
  Schema.Struct({ url: ConnectorUrl }),
]);
export type ConnectorTarget = typeof ConnectorTarget.Type;

/** The agent's card this connection answers; finishing turns it on for that bot and closes the card. */
export const ConnectorRequestRef = Schema.Struct({
  threadId: ThreadId,
  turnItemId: TurnItemId,
});
export type ConnectorRequestRef = typeof ConnectorRequestRef.Type;

/**
 * The environment's HTTP origin as this client reaches it, e.g. `http://localhost:3773` or the
 * T3 Connect hostname. Not the page origin on app.t3.codes. The provider redirects the browser to
 * `<origin>/oauth/connectors/callback`, which must reach this server.
 */
const RedirectOrigin = TrimmedNonEmptyString.check(
  Schema.isMaxLength(512),
  Schema.isPattern(/^https?:\/\/[^/?#]+$/i),
);

export const ConnectorsDetectAuthInput = Schema.Struct({ url: ConnectorUrl });
export const ConnectorsDetectAuthResult = Schema.Struct({ authKind: ConnectorAuthKind });
export type ConnectorsDetectAuthResult = typeof ConnectorsDetectAuthResult.Type;

export const ConnectorsStartOAuthInput = Schema.Struct({
  target: ConnectorTarget,
  /** Defaults to the catalog name or the server's host. */
  displayName: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(80))),
  redirectOrigin: RedirectOrigin,
  forRequest: Schema.optionalKey(ConnectorRequestRef),
});
export type ConnectorsStartOAuthInput = typeof ConnectorsStartOAuthInput.Type;

/** Open `authorizationUrl` in a browser; the connection turns `connected` when the callback lands. */
export const ConnectorsAuthorizationResult = Schema.Struct({
  connectionId: ConnectorConnectionId,
  authorizationUrl: TrimmedNonEmptyString,
});
export type ConnectorsAuthorizationResult = typeof ConnectorsAuthorizationResult.Type;

export const ConnectorKeyCredential = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("api-key"),
    apiKey: TrimmedNonEmptyString.check(Schema.isMaxLength(8192)),
    /** Only for a server added by URL; catalog entries name their header. Default `Authorization`. */
    headerName: Schema.optionalKey(
      TrimmedNonEmptyString.check(Schema.isPattern(/^[A-Za-z0-9-]{1,64}$/)),
    ),
  }),
  Schema.Struct({ type: Schema.Literal("none") }),
]);
export type ConnectorKeyCredential = typeof ConnectorKeyCredential.Type;

/** Adds an API-key (or open) connection. OAuth connections start with `startOAuth`. */
export const ConnectorsAddConnectionInput = Schema.Struct({
  target: ConnectorTarget,
  displayName: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(80))),
  credential: ConnectorKeyCredential,
  forRequest: Schema.optionalKey(ConnectorRequestRef),
});
export type ConnectorsAddConnectionInput = typeof ConnectorsAddConnectionInput.Type;

export const ConnectorsRenameInput = Schema.Struct({
  connectionId: ConnectorConnectionId,
  displayName: TrimmedNonEmptyString.check(Schema.isMaxLength(80)),
});
export type ConnectorsRenameInput = typeof ConnectorsRenameInput.Type;

/** Signs a connection in again: a new OAuth grant, or a new key. */
export const ConnectorsReauthenticateInput = Schema.Struct({
  connectionId: ConnectorConnectionId,
  credential: Schema.Union([
    Schema.Struct({ type: Schema.Literal("oauth"), redirectOrigin: RedirectOrigin }),
    Schema.Struct({
      type: Schema.Literal("api-key"),
      apiKey: TrimmedNonEmptyString.check(Schema.isMaxLength(8192)),
    }),
  ]),
  forRequest: Schema.optionalKey(ConnectorRequestRef),
});
export type ConnectorsReauthenticateInput = typeof ConnectorsReauthenticateInput.Type;

/** OAuth answers with a URL to open; a key takes effect at once. */
export const ConnectorsReauthenticateResult = Schema.Struct({
  authorizationUrl: Schema.NullOr(TrimmedNonEmptyString),
});
export type ConnectorsReauthenticateResult = typeof ConnectorsReauthenticateResult.Type;

export const ConnectorsConnectionInput = Schema.Struct({ connectionId: ConnectorConnectionId });
export type ConnectorsConnectionInput = typeof ConnectorsConnectionInput.Type;

export const ConnectorsSetBotConnectionInput = Schema.Struct({
  projectId: ProjectId,
  connectionId: ConnectorConnectionId,
  enabled: Schema.Boolean,
});
export type ConnectorsSetBotConnectionInput = typeof ConnectorsSetBotConnectionInput.Type;

export const ConnectorsTestResult = Schema.Struct({ toolCount: NonNegativeInt });
export type ConnectorsTestResult = typeof ConnectorsTestResult.Type;

/**
 * Answers an agent's connection card. `use-existing` turns that connection on for the bot.
 * Connecting a new one goes through `startOAuth`/`addConnection` with `forRequest` instead.
 */
export const ConnectorsAnswerRequestInput = Schema.Struct({
  threadId: ThreadId,
  turnItemId: TurnItemId,
  answer: Schema.Union([
    Schema.Struct({ type: Schema.Literal("use-existing"), connectionId: ConnectorConnectionId }),
    Schema.Struct({ type: Schema.Literal("decline") }),
  ]),
});
export type ConnectorsAnswerRequestInput = typeof ConnectorsAnswerRequestInput.Type;

const CONNECTOR_ERROR_MESSAGES = {
  unknown_catalog_entry: "That connector is not in the catalog.",
  unknown_connection: "That connection no longer exists.",
  unknown_project: "That bot no longer exists.",
  auth_kind_mismatch: "That connector signs in another way.",
  not_connected: "Sign in to this connection first.",
  unreachable: "The server did not answer.",
  oauth_unsupported: "This server's sign-in can't be used by Pocks.",
  oauth_failed: "Signing in failed.",
  test_failed: "The server did not list its tools.",
  request_not_found: "This connection request no longer exists.",
  request_already_answered: "This connection request was already answered.",
  storage: "Could not save the connection.",
} as const;

export const ConnectorErrorReason = Schema.Literals(
  Object.keys(CONNECTOR_ERROR_MESSAGES) as Array<keyof typeof CONNECTOR_ERROR_MESSAGES>,
);
export type ConnectorErrorReason = typeof ConnectorErrorReason.Type;

export class ConnectorError extends Schema.TaggedError<ConnectorError>()("ConnectorError", {
  reason: ConnectorErrorReason,
  /** A short, safe detail such as the server's OAuth error code or HTTP status. */
  detail: Schema.optionalKey(Schema.String),
  cause: Schema.optionalKey(Schema.Defect()),
}) {
  override get message(): string {
    const base = CONNECTOR_ERROR_MESSAGES[this.reason];
    return this.detail === undefined ? base : `${base} (${this.detail})`;
  }
}

export const OrchestratorMcpListConnectorsResult = Schema.Struct({
  catalog: Schema.Array(
    Schema.Struct({
      catalogId: ConnectorCatalogId,
      name: Schema.String,
      description: Schema.String,
    }),
  ),
  connections: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      catalogId: Schema.NullOr(ConnectorCatalogId),
      url: Schema.String,
      serverName: Schema.String.annotate({
        description: "Its tools appear under this MCP server name.",
      }),
      status: Schema.Literals(["connected", "needs_auth", "error", "not_enabled"]).annotate({
        description:
          "not_enabled: connected but off for you; needs_auth/error: the user must fix it. Use request_connection either way.",
      }),
    }),
  ),
});
export type OrchestratorMcpListConnectorsResult = typeof OrchestratorMcpListConnectorsResult.Type;

export const OrchestratorMcpRequestConnectionInput = Schema.Struct({
  catalogId: Schema.optional(ConnectorCatalogId).annotate({
    description: "From list_connectors.",
  }),
  url: Schema.optional(ConnectorUrl).annotate({
    description: "A remote MCP server URL the user gave, when it isn't in the catalog.",
  }),
  reason: TrimmedNonEmptyString.annotate({ description: "One sentence for the card." }),
  clientRequestId: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(128)).annotate({
      description: "Reuse it on retry so only one card is shown.",
    }),
  ),
});
export type OrchestratorMcpRequestConnectionInput =
  typeof OrchestratorMcpRequestConnectionInput.Type;

export const OrchestratorMcpRequestConnectionResult = Schema.Struct({
  status: Schema.Literals(["already_connected", "card_shown"]).annotate({
    description:
      "already_connected: its tools are yours now. card_shown: end your turn; the answer arrives as a message.",
  }),
  serverName: Schema.optional(Schema.String),
  turnItemId: Schema.optional(TurnItemId),
});
export type OrchestratorMcpRequestConnectionResult =
  typeof OrchestratorMcpRequestConnectionResult.Type;
