import type {
  ConnectorAuthKind,
  ConnectorCatalogEntry,
  ConnectorConnection,
  ConnectorConnectionId,
  ConnectorsAnswerRequestInput,
  ConnectorTarget,
  OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import { isLocalLoopbackHost } from "@t3tools/shared/hostClassification";

export type ConnectionRequestItem = Extract<
  OrchestrationV2TurnItem,
  { readonly type: "connection_request" }
>;

/** How a new connection to a connector signs in; a server added by URL is probed first. */
export type ConnectorSignIn = ConnectorAuthKind | "detect";

/** The catalog entry, or the URL, a card or gallery tile connects to. */
export interface ConnectorChoice {
  readonly target: ConnectorTarget;
  readonly name: string;
  readonly signIn: ConnectorSignIn;
  readonly entry: ConnectorCatalogEntry | null;
}

const sameUrl = (left: string, right: string) =>
  left.trim().replace(/\/+$/, "").toLowerCase() === right.trim().replace(/\/+$/, "").toLowerCase();

/** What a card asks to connect: its catalog entry when it names one, else its URL. */
export function connectionRequestChoice(
  item: Pick<ConnectionRequestItem, "catalogId" | "url" | "label">,
  catalog: ReadonlyArray<ConnectorCatalogEntry>,
): ConnectorChoice | null {
  const entry =
    item.catalogId === undefined
      ? undefined
      : catalog.find((candidate) => candidate.id === item.catalogId);
  if (entry !== undefined) return catalogChoice(entry);
  return item.url === undefined
    ? null
    : { target: { url: item.url }, name: item.label, signIn: "detect", entry: null };
}

export const catalogChoice = (entry: ConnectorCatalogEntry): ConnectorChoice => ({
  target: { catalogId: entry.id },
  name: entry.name,
  signIn: entry.auth.kind,
  entry,
});

/**
 * The connection that best answers a card: the one it resolved to while that still exists,
 * else one for the same connector, preferring one already on for the bot, then a working one.
 */
export function connectionForRequest(
  item: Pick<ConnectionRequestItem, "catalogId" | "url" | "connectionId">,
  connections: ReadonlyArray<ConnectorConnection>,
  botConnectionIds: ReadonlyArray<ConnectorConnectionId>,
): ConnectorConnection | null {
  const resolved =
    item.connectionId === undefined
      ? undefined
      : connections.find((connection) => connection.id === item.connectionId);
  if (resolved !== undefined) return resolved;
  const matches = connections.filter((connection) =>
    item.catalogId !== undefined
      ? connection.catalogId === item.catalogId
      : item.url !== undefined && sameUrl(connection.url, item.url),
  );
  const rank = (connection: ConnectorConnection) =>
    (botConnectionIds.includes(connection.id) ? 0 : 2) +
    (connection.status === "connected" ? 0 : 1);
  return [...matches].sort((left, right) => rank(left) - rank(right))[0] ?? null;
}

/**
 * What a connection card shows. The card's record is final once answered, so an answered card
 * follows the live connection: it can need a sign-in, be off for the bot, or be gone.
 */
export type ConnectionCardState =
  | { readonly kind: "waiting-elsewhere" }
  /** Nothing usable yet: connect a new one. `reconnect` once the card's connection is gone. */
  | { readonly kind: "connect"; readonly reconnect: boolean }
  /** Pending, and a working connection is already on for the bot: telling the bot is left. */
  | { readonly kind: "use"; readonly connection: ConnectorConnection }
  | {
      readonly kind: "turn-on";
      readonly connection: ConnectorConnection;
      readonly answered: boolean;
    }
  | {
      readonly kind: "sign-in";
      readonly connection: ConnectorConnection;
      readonly answered: boolean;
    }
  /** An open server whose last check failed: there is nothing to sign in to, only to retry. */
  | { readonly kind: "retry"; readonly connection: ConnectorConnection; readonly answered: boolean }
  | { readonly kind: "connected"; readonly connection: ConnectorConnection }
  | { readonly kind: "declined" }
  | { readonly kind: "ended" }
  | { readonly kind: "failed"; readonly detail: string };

export function connectionCardState(input: {
  readonly item: Pick<
    ConnectionRequestItem,
    "catalogId" | "url" | "connectionId" | "connectionStatus" | "failure"
  >;
  /** The projected row's: a card inherited from another thread is answered where it was asked. */
  readonly visibility: "local" | "inherited" | "synthetic";
  readonly connections: ReadonlyArray<ConnectorConnection>;
  readonly botConnectionIds: ReadonlyArray<ConnectorConnectionId>;
}): ConnectionCardState {
  const { item } = input;
  switch (item.connectionStatus) {
    case "declined":
      return { kind: "declined" };
    case "cancelled":
      return { kind: "ended" };
    case "failed":
      return { kind: "failed", detail: item.failure ?? "the server refused" };
    case "pending":
      if (input.visibility !== "local") return { kind: "waiting-elsewhere" };
  }
  const answered = item.connectionStatus === "connected";
  const connection = connectionForRequest(item, input.connections, input.botConnectionIds);
  if (connection === null) return { kind: "connect", reconnect: answered };
  if (connection.status !== "connected") {
    return connection.authKind === "none"
      ? { kind: "retry", connection, answered }
      : { kind: "sign-in", connection, answered };
  }
  if (!input.botConnectionIds.includes(connection.id)) {
    return { kind: "turn-on", connection, answered };
  }
  return answered ? { kind: "connected", connection } : { kind: "use", connection };
}

/** The card's one-line status and its main action's label, the same on every client. */
export function connectionCardCopy(
  state: ConnectionCardState,
  botName: string,
): { readonly status: string; readonly action: string | null; readonly declinable: boolean } {
  switch (state.kind) {
    case "waiting-elsewhere":
      return {
        status: "Waiting for an answer in the original thread",
        action: null,
        declinable: false,
      };
    case "connect":
      return state.reconnect
        ? { status: "Disconnected", action: "Reconnect", declinable: false }
        : { status: "Not connected", action: "Connect", declinable: true };
    case "use":
      return {
        status: `Connected as ${state.connection.displayName}`,
        action: `Use ${state.connection.displayName}`,
        declinable: true,
      };
    case "turn-on":
      return {
        status: `${state.connection.displayName} is off for ${botName}`,
        action: `Turn on for ${botName}`,
        declinable: !state.answered,
      };
    case "sign-in":
      return {
        status: connectionStatusLabel(state.connection),
        action: "Sign in again",
        declinable: !state.answered,
      };
    case "retry":
      return {
        status: connectionStatusLabel(state.connection),
        action: "Try again",
        declinable: !state.answered,
      };
    case "connected":
      return {
        status: `Connected ✓ · ${state.connection.displayName}`,
        action: null,
        declinable: false,
      };
    case "declined":
      return { status: "Declined", action: null, declinable: false };
    case "ended":
      return { status: "Request ended", action: null, declinable: false };
    case "failed":
      return { status: `Could not connect: ${state.detail}`, action: null, declinable: false };
  }
}

/** "Connected", "Needs sign-in", or the error with its detail. */
export function connectionStatusLabel(
  connection: Pick<ConnectorConnection, "status" | "statusDetail">,
): string {
  switch (connection.status) {
    case "connected":
      return "Connected";
    case "needs_auth":
      return "Needs sign-in";
    case "error":
      return connection.statusDetail ? `Error: ${connection.statusDetail}` : "Error";
  }
}

/** The answer that turns a working connection on for the card's bot and closes the card. */
export const connectionRequestUseExisting = (
  item: Pick<ConnectionRequestItem, "id" | "threadId">,
  connectionId: ConnectorConnectionId,
): ConnectorsAnswerRequestInput => ({
  threadId: item.threadId,
  turnItemId: item.id,
  answer: { type: "use-existing", connectionId },
});

export const connectionRequestDecline = (
  item: Pick<ConnectionRequestItem, "id" | "threadId">,
): ConnectorsAnswerRequestInput => ({
  threadId: item.threadId,
  turnItemId: item.id,
  answer: { type: "decline" },
});

/**
 * Where a provider sends the browser back after sign-in: the environment's HTTP origin as this
 * client reaches it. Plain http off this machine is refused by most authorization servers.
 */
export function connectorRedirectOrigin(
  httpBaseUrl: string | null,
): { readonly origin: string; readonly insecureRemote: boolean } | null {
  if (httpBaseUrl === null) return null;
  let url: URL;
  try {
    url = new URL(httpBaseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return {
    origin: url.origin,
    insecureRemote: url.protocol === "http:" && !isLocalLoopbackHost(url.hostname),
  };
}

export const INSECURE_REDIRECT_WARNING =
  "This app reaches the server over plain http, which most services refuse for sign-in. Sign in from the server's machine, or connect to it through T3 Connect.";

/** The bots a connection is on for, by name, for its row and for the remove confirmation. */
export function botsUsingConnection<
  P extends {
    readonly title: string;
    readonly connectionIds?: ReadonlyArray<ConnectorConnectionId> | undefined;
  },
>(projects: ReadonlyArray<P>, connectionId: ConnectorConnectionId): ReadonlyArray<P> {
  return projects.filter((project) => project.connectionIds?.includes(connectionId) === true);
}

/** Catalog entries whose name or description holds every word of the query. */
export function searchConnectorCatalog(
  entries: ReadonlyArray<ConnectorCatalogEntry>,
  query: string,
): ReadonlyArray<ConnectorCatalogEntry> {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return entries;
  return entries.filter((entry) => {
    const text = `${entry.name} ${entry.description} ${entry.id}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/** The one or two letters a connector's icon falls back to. */
export function connectorMonogram(name: string): string {
  const letters = name.match(/[\p{L}\p{N}]/gu) ?? [];
  return (letters[0] ?? "?").toUpperCase();
}

/** Failures whose message is written for the user. Others get generic copy. */
const USER_FACING_FAILURE_TAGS = new Set(["ConnectorError", "EnvironmentAuthorizationError"]);

export function connectorFailureMessage(
  failure: unknown,
  fallback = "Something went wrong. Try again.",
): string {
  if (
    typeof failure === "object" &&
    failure !== null &&
    "_tag" in failure &&
    typeof failure._tag === "string" &&
    USER_FACING_FAILURE_TAGS.has(failure._tag) &&
    "message" in failure &&
    typeof failure.message === "string" &&
    failure.message.trim().length > 0
  ) {
    return failure.message;
  }
  return fallback;
}
