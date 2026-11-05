import { CONNECTOR_CALLBACK_PATH, ConnectorError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpBody from "effect/http/HttpBody";

import { parseBearerToken } from "../auth/EnvironmentAuth.ts";
import * as McpSessionRegistry from "../mcp/McpSessionRegistry.ts";
import { requestUrl } from "../requestUrl.ts";
import { CONNECTOR_PROXY_PATH } from "./ConnectorServers.ts";
import * as Connectors from "./Connectors.ts";

const htmlPage = (html: string, status = 200) =>
  HttpServerResponse.text(html, {
    status,
    contentType: "text/html; charset=utf-8",
    headers: PAGE_HEADERS,
  });

const PAGE_HEADERS = {
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/gu,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );

const page = (title: string, body: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: light dark; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 32px 16px; }
      main { width: min(100%, 420px); }
      h1 { margin: 0 0 8px; font-size: 20px; }
      p { margin: 0; line-height: 1.5; opacity: 0.75; }
    </style>
  </head>
  <body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></main></body>
</html>`;

/**
 * Where the connector's authorization server sends the browser back. The `state` is the only
 * credential: random, single-use, and short-lived. Works on any origin that reaches this server,
 * including a T3 Connect hostname, so mobile opens the same URL in a system auth session.
 */
// Route handlers resolve services when served, so they close over ones taken at construction.
export const layerCallbackRoute = Layer.unwrap(
  Effect.gen(function* () {
    const connectors = yield* Connectors.Connectors;
    return HttpRouter.add("GET", CONNECTOR_CALLBACK_PATH, callback(connectors));
  }),
);

const callback = Effect.fn("ConnectorHttp.callback")(function* (
  connectors: Connectors.Connectors["Service"],
) {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const params = Option.match(requestUrl(request), {
    onNone: () => new URLSearchParams(),
    onSome: (url) => url.searchParams,
  });
  const state = params.get("state");
  if (state === null) {
    return htmlPage(page("Sign-in failed", "This link is incomplete."), 400);
  }
  return yield* connectors
    .completeOAuth({
      state,
      ...(params.get("code") === null ? {} : { code: params.get("code")! }),
      ...(params.get("error") === null ? {} : { error: params.get("error")! }),
    })
    .pipe(
      Effect.map((connection) =>
        htmlPage(page(`${connection.displayName} connected`, "You can close this tab.")),
      ),
      Effect.catchTags({
        ConnectorError: (error) =>
          Effect.succeed(
            htmlPage(page("Sign-in failed", `${error.message} Close this tab and try again.`), 400),
          ),
      }),
    );
});

// Hop-by-hop headers, and ones the proxy sets itself.
const DROPPED_RESPONSE_HEADERS = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "set-cookie",
  // A provider CLI seeing a challenge would start its own OAuth; Pocks owns sign-in.
  "www-authenticate",
]);
const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "content-type",
  "mcp-session-id",
  "mcp-protocol-version",
  "last-event-id",
];
const MAX_REQUEST_BYTES = 4 * 1024 * 1024;

const jsonError = (status: number, error: string, message: string) =>
  HttpServerResponse.jsonUnsafe(
    { error, message },
    { status, headers: { "cache-control": "no-store" } },
  );

/**
 * `/mcp-connectors/<serverName>`: forwards a provider's MCP request to the connector's server
 * with the stored credentials. The provider authenticates with its thread's T3 MCP credential,
 * and only connections turned on for that thread's bot answer.
 */
const proxy = Effect.fn("ConnectorHttp.proxy")(function* (services: {
  readonly registry: McpSessionRegistry.McpSessionRegistry["Service"];
  readonly connectors: Connectors.Connectors["Service"];
  readonly httpClient: HttpClient.HttpClient;
}) {
  const { registry, connectors } = services;
  const request = yield* HttpServerRequest.HttpServerRequest;
  const httpClient = HttpClient.withScope(services.httpClient);
  const token = parseBearerToken(request);
  const scope = token === null ? undefined : yield* registry.resolve(token);
  if (scope === undefined) {
    return jsonError(401, "invalid_mcp_credential", "A valid Boops MCP credential is required.");
  }
  const serverName = Option.match(requestUrl(request), {
    onNone: () => "",
    onSome: (url) => decodeURIComponent(url.pathname.slice(CONNECTOR_PROXY_PATH.length + 1)),
  });
  const method = request.method;
  if (method !== "GET" && method !== "POST" && method !== "DELETE") {
    return jsonError(405, "method_not_allowed", "MCP uses GET, POST and DELETE.");
  }
  const body =
    method === "POST"
      ? yield* request.arrayBuffer.pipe(
          Effect.map((buffer) => new Uint8Array(buffer)),
          Effect.option,
        )
      : Option.some(new Uint8Array());
  if (Option.isNone(body) || body.value.byteLength > MAX_REQUEST_BYTES) {
    return jsonError(413, "body_too_large", "The request is too large.");
  }
  const forwarded: Record<string, string> = {};
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers[name];
    if (value !== undefined) forwarded[name] = value;
  }
  const send = (target: {
    readonly url: string;
    readonly headers: Readonly<Record<string, string>>;
  }) =>
    httpClient.execute(
      HttpClientRequest.make(method)(target.url).pipe(
        HttpClientRequest.setHeaders({ ...forwarded, ...target.headers }),
        method === "POST"
          ? HttpClientRequest.setBody(
              HttpBody.uint8Array(
                body.value,
                request.headers["content-type"] ?? "application/json",
              ),
            )
          : (self) => self,
      ),
    );
  const outcome = yield* Effect.gen(function* () {
    const target = yield* connectors.upstream({ threadId: scope.thread.threadId, serverName });
    const first = yield* send(target).pipe(
      Effect.mapError((cause) => new ConnectorError({ reason: "unreachable", cause })),
    );
    if (first.status !== 401) return first;
    // An access token revoked before its expiry: refresh once, then give up.
    const retried = yield* connectors
      .upstream({ threadId: scope.thread.threadId, serverName, forceRefresh: true })
      .pipe(
        Effect.flatMap((fresh) =>
          send(fresh).pipe(
            Effect.mapError((cause) => new ConnectorError({ reason: "unreachable", cause })),
          ),
        ),
        Effect.option,
      );
    if (Option.isSome(retried) && retried.value.status !== 401) return retried.value;
    yield* connectors.markNeedsAuth(target.connectionId);
    return Option.getOrElse(retried, () => first);
  }).pipe(Effect.result);
  if (outcome._tag === "Failure") {
    const error = outcome.failure;
    return error.reason === "unreachable"
      ? jsonError(502, "connector_unreachable", "The connector's server did not answer.")
      : jsonError(
          403,
          "connector_unavailable",
          "This connector is not connected for this bot. Ask the user to connect it.",
        );
  }
  const response = outcome.success;
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(response.headers)) {
    if (!DROPPED_RESPONSE_HEADERS.has(name) && value !== undefined) headers[name] = value;
  }
  headers["cache-control"] = "no-store, no-transform";
  return HttpServerResponse.stream(response.stream, {
    status: response.status,
    headers,
    ...(headers["content-type"] ? { contentType: headers["content-type"] } : {}),
  });
});

export const layerProxyRoute = Layer.unwrap(
  Effect.gen(function* () {
    const handler = proxy({
      registry: yield* McpSessionRegistry.McpSessionRegistry,
      connectors: yield* Connectors.Connectors,
      httpClient: yield* HttpClient.HttpClient,
    });
    return Layer.mergeAll(
      HttpRouter.add("GET", `${CONNECTOR_PROXY_PATH}/:serverName`, handler),
      HttpRouter.add("POST", `${CONNECTOR_PROXY_PATH}/:serverName`, handler),
      HttpRouter.add("DELETE", `${CONNECTOR_PROXY_PATH}/:serverName`, handler),
    );
  }),
);
