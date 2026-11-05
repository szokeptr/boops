import {
  type ConnectorConnection,
  ConnectorConnectionId,
  type ConnectorConnectionStatus,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  type ConnectionCardState,
  connectionCardState,
  connectionForRequest,
  connectorRedirectOrigin,
} from "./connectors.ts";

const linearId = ConnectorConnectionId.make("connection-linear");
const otherId = ConnectorConnectionId.make("connection-linear-2");

const connection = (
  status: ConnectorConnectionStatus,
  overrides: Partial<ConnectorConnection> = {},
): ConnectorConnection => ({
  id: linearId,
  catalogId: "linear",
  displayName: "Linear",
  url: "https://mcp.linear.app/mcp",
  authKind: "oauth",
  status,
  statusDetail: null,
  toolCount: 12,
  serverName: "linear_3f9a1c",
  createdAt: "2026-11-05T10:00:00.000Z",
  updatedAt: "2026-11-05T10:00:00.000Z",
  ...overrides,
});

const pending = { catalogId: "linear", connectionStatus: "pending" } as const;
const answered = {
  catalogId: "linear",
  connectionStatus: "connected",
  connectionId: linearId,
} as const;

describe("connectionCardState", () => {
  it.each<
    [
      string,
      Parameters<typeof connectionCardState>[0]["item"],
      ReadonlyArray<ConnectorConnection>,
      ReadonlyArray<ConnectorConnectionId>,
      ConnectionCardState["kind"],
    ]
  >([
    ["pending, nothing connected", pending, [], [], "connect"],
    ["pending, connected and off", pending, [connection("connected")], [], "turn-on"],
    ["pending, connected and on", pending, [connection("connected")], [linearId], "use"],
    ["pending, needs sign-in", pending, [connection("needs_auth")], [linearId], "sign-in"],
    ["pending, error with a sign-in", pending, [connection("error")], [], "sign-in"],
    [
      "pending, open server failing",
      pending,
      [connection("error", { authKind: "none" })],
      [],
      "retry",
    ],
    ["answered, connected and on", answered, [connection("connected")], [linearId], "connected"],
    ["answered, turned off later", answered, [connection("connected")], [], "turn-on"],
    ["answered, disconnected later", answered, [connection("needs_auth")], [linearId], "sign-in"],
    ["answered, removed later", answered, [], [], "connect"],
    [
      "declined",
      { ...pending, connectionStatus: "declined" },
      [connection("connected")],
      [],
      "declined",
    ],
    ["cancelled", { ...pending, connectionStatus: "cancelled" }, [], [], "ended"],
    ["failed", { ...pending, connectionStatus: "failed", failure: "denied" }, [], [], "failed"],
  ])("%s", (_name, item, connections, botConnectionIds, kind) => {
    expect(
      connectionCardState({ item, visibility: "local", connections, botConnectionIds }).kind,
    ).toBe(kind);
  });

  it("marks a card answered so it no longer offers Not now, and a removed one as reconnect", () => {
    const live = { visibility: "local" as const, botConnectionIds: [] };
    expect(connectionCardState({ ...live, item: pending, connections: [] })).toEqual({
      kind: "connect",
      reconnect: false,
    });
    expect(connectionCardState({ ...live, item: answered, connections: [] })).toEqual({
      kind: "connect",
      reconnect: true,
    });
    expect(
      connectionCardState({ ...live, item: answered, connections: [connection("connected")] }),
    ).toMatchObject({ kind: "turn-on", answered: true });
  });

  it("leaves a pending card inherited from another thread to that thread", () => {
    for (const visibility of ["inherited", "synthetic"] as const) {
      expect(
        connectionCardState({
          item: pending,
          visibility,
          connections: [connection("connected")],
          botConnectionIds: [linearId],
        }),
      ).toEqual({ kind: "waiting-elsewhere" });
    }
    expect(
      connectionCardState({
        item: answered,
        visibility: "inherited",
        connections: [connection("connected")],
        botConnectionIds: [linearId],
      }).kind,
    ).toBe("connected");
  });
});

describe("connectionForRequest", () => {
  it("follows the card's own connection, else the best one for the same connector", () => {
    const broken = connection("needs_auth");
    const working = connection("connected", { id: otherId, displayName: "Linear (work)" });
    expect(connectionForRequest(answered, [working, broken], [])).toBe(broken);
    expect(connectionForRequest(pending, [broken, working], [])).toBe(working);
    expect(connectionForRequest(pending, [working, broken], [linearId])).toBe(broken);
    expect(connectionForRequest({ url: "https://MCP.linear.app/mcp/" }, [working], [])).toBe(
      working,
    );
    expect(connectionForRequest({ catalogId: "notion" }, [working], [])).toBeNull();
  });
});

describe("connectorRedirectOrigin", () => {
  it.each([
    ["http://localhost:3773/", "http://localhost:3773", false],
    ["http://127.0.0.1:3773", "http://127.0.0.1:3773", false],
    ["https://box.example.ts.net/base", "https://box.example.ts.net", false],
    ["http://192.168.1.20:3773", "http://192.168.1.20:3773", true],
    ["http://box.tail1234.ts.net:3773", "http://box.tail1234.ts.net:3773", true],
  ])("%s", (httpBaseUrl, origin, insecureRemote) => {
    expect(connectorRedirectOrigin(httpBaseUrl)).toEqual({ origin, insecureRemote });
  });

  it("has no origin without an http base URL", () => {
    expect(connectorRedirectOrigin(null)).toBeNull();
    expect(connectorRedirectOrigin("ws://localhost:3773")).toBeNull();
  });
});
