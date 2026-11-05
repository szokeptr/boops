/** Just enough of an MCP Streamable HTTP client to probe a server and count its tools. */
import { ConnectorError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as HttpBody from "effect/http/HttpBody";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

import { send } from "./connectorOAuth.ts";

const PROTOCOL_VERSION = "2025-06-18";
// A server that pages forever must not hold a check open.
const MAX_TOOL_PAGES = 20;

const initialize = {
  jsonrpc: "2.0",
  id: 0,
  method: "initialize",
  params: {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "pocks", version: "1" },
  },
};

const request = (
  method: "POST" | "DELETE",
  url: string,
  headers: Readonly<Record<string, string>>,
  body?: unknown,
) =>
  HttpClientRequest.make(method)(url).pipe(
    HttpClientRequest.setHeaders({
      accept: "application/json, text/event-stream",
      ...headers,
    }),
    body === undefined
      ? (request) => request
      : HttpClientRequest.setBody(HttpBody.text(JSON.stringify(body), "application/json")),
  );

const JsonRpcResponse = Schema.Struct({
  id: Schema.optionalKey(Schema.Union([Schema.Number, Schema.String, Schema.Null])),
  result: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(Schema.Struct({ message: Schema.String })),
});
const decodeResponse = Schema.decodeUnknownOption(Schema.fromJsonString(JsonRpcResponse));
const ToolsPage = Schema.Struct({
  tools: Schema.Array(Schema.Unknown),
  nextCursor: Schema.optionalKey(Schema.String),
});
const decodeToolsPage = Schema.decodeUnknownOption(ToolsPage);

/** The JSON-RPC response with `id`, from a JSON body or any event of an SSE body. */
const responseFor = (contentType: string | undefined, text: string, id: number) => {
  const candidates = contentType?.includes("text/event-stream")
    ? text
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trim())
    : [text];
  for (const candidate of candidates) {
    const decoded = decodeResponse(candidate);
    if (decoded._tag === "Some" && decoded.value.id === id) return decoded.value;
  }
  return undefined;
};

/** How the server answers an `initialize` with `headers`: its status and any bearer challenge. */
export const probe = Effect.fn("ConnectorMcp.probe")(function* (
  url: string,
  headers: Readonly<Record<string, string>>,
) {
  const { response } = yield* send(request("POST", url, headers, initialize));
  return { status: response.status, challenge: response.headers["www-authenticate"] };
});

/**
 * Initializes a session, lists every tool, and ends the session. A 401 or 403 fails with
 * `not_connected`; any other refusal with `test_failed`.
 */
export const countTools = Effect.fn("ConnectorMcp.countTools")(function* (
  url: string,
  headers: Readonly<Record<string, string>>,
) {
  const refused = (status: number) =>
    new ConnectorError({
      reason: status === 401 || status === 403 ? "not_connected" : "test_failed",
      detail: `HTTP ${status}`,
    });
  const init = yield* send(request("POST", url, headers, initialize));
  if (init.response.status !== 200) return yield* refused(init.response.status);
  const initialized = responseFor(init.response.headers["content-type"], init.text, 0);
  if (initialized === undefined || initialized.error !== undefined) {
    return yield* new ConnectorError({ reason: "test_failed", detail: "initialize" });
  }
  const sessionId = init.response.headers["mcp-session-id"];
  const sessionHeaders = {
    ...headers,
    "mcp-protocol-version": PROTOCOL_VERSION,
    ...(sessionId === undefined ? {} : { "mcp-session-id": sessionId }),
  };
  const notified = yield* send(
    request("POST", url, sessionHeaders, { jsonrpc: "2.0", method: "notifications/initialized" }),
  );
  if (notified.response.status >= 400) return yield* refused(notified.response.status);
  let count = 0;
  let cursor: string | undefined;
  for (let page = 1; page <= MAX_TOOL_PAGES; page++) {
    const listed = yield* send(
      request("POST", url, sessionHeaders, {
        jsonrpc: "2.0",
        id: page,
        method: "tools/list",
        params: cursor === undefined ? {} : { cursor },
      }),
    );
    if (listed.response.status !== 200) return yield* refused(listed.response.status);
    const result = responseFor(listed.response.headers["content-type"], listed.text, page);
    const tools = result === undefined ? undefined : decodeToolsPage(result.result);
    if (tools === undefined || tools._tag === "None") {
      return yield* new ConnectorError({ reason: "test_failed", detail: "tools/list" });
    }
    count += tools.value.tools.length;
    cursor = tools.value.nextCursor;
    if (cursor === undefined) break;
  }
  if (sessionId !== undefined) {
    yield* send(request("DELETE", url, sessionHeaders)).pipe(Effect.ignore);
  }
  return count;
});
