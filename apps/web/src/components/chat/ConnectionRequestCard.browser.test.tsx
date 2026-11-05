import type { ConnectionRequestItem } from "@t3tools/client-runtime/connectors";
import {
  type ConnectorConnection,
  ConnectorConnectionId,
  EnvironmentId,
  ProjectId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";

const mocks = vi.hoisted(() => ({
  live: {
    connections: [] as ReadonlyArray<ConnectorConnection>,
    botConnectionIds: [] as ReadonlyArray<string>,
  },
  answer: vi.fn(),
  setBot: vi.fn(),
}));

vi.mock(import("~/state/connectors"), async () => {
  const { Atom } = await import("effect/reactivity");
  const allowed = Atom.make(true);
  const command = (label: string) => ({ label, permissionAtom: () => allowed });
  return {
    connectorEnvironment: {
      answerRequest: command("answer"),
      setBotConnection: command("set-bot"),
      detectAuth: command("detect"),
      startOAuth: command("start"),
      addConnection: command("add"),
      reauthenticate: command("reauthenticate"),
      test: command("test"),
    } as never,
    useConnectorConnections: () => ({
      connections: mocks.live.connections,
      loaded: true,
      error: null,
    }),
    useConnectorCatalog: () => ({ entries: [], error: null, isPending: false }),
    useConnectorRedirect: () => ({ origin: "http://localhost:3773", insecureRemote: false }),
    useEnvironmentBots: () => [],
  };
});
vi.mock(import("~/state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: ((command: { label: string }) =>
    command.label === "answer"
      ? mocks.answer
      : command.label === "set-bot"
        ? mocks.setBot
        : vi.fn()) as never,
}));
vi.mock(import("~/state/entities"), async (original) => ({
  ...(await original()),
  useThreadShell: (() => ({ projectId: ProjectId.make("project-ada") })) as never,
  useProject: (() => ({
    id: ProjectId.make("project-ada"),
    title: "Ada",
    connectionIds: mocks.live.botConnectionIds,
  })) as never,
}));

import { ConnectionRequestCard } from "./ConnectionRequestCard";

const environmentId = EnvironmentId.make("environment-local");
const linearId = ConnectorConnectionId.make("connection-linear");
const linear: ConnectorConnection = {
  id: linearId,
  catalogId: "linear",
  displayName: "Linear",
  url: "https://mcp.linear.app/mcp",
  authKind: "oauth",
  status: "connected",
  statusDetail: null,
  toolCount: 12,
  serverName: "linear_3f9a1c",
  createdAt: "2026-11-05T10:00:00.000Z",
  updatedAt: "2026-11-05T10:00:00.000Z",
};
const card = (overrides: Partial<ConnectionRequestItem> = {}) =>
  ({
    type: "connection_request",
    id: TurnItemId.make("turn-item:connection-request:1"),
    threadId: ThreadId.make("thread-ada"),
    catalogId: "linear",
    label: "Linear",
    reason: "To read your sprint board.",
    connectionStatus: "pending",
    ...overrides,
  }) as ConnectionRequestItem;

const view = (item: ConnectionRequestItem) => (
  <ConnectionRequestCard environmentId={environmentId} item={item} visibility="local" />
);

function setup() {
  mocks.live.connections = [];
  mocks.live.botConnectionIds = [];
  mocks.answer.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  mocks.setBot.mockReset().mockResolvedValue(AsyncResult.success(undefined));
}

it("follows the live connections from not connected to connected and back", async () => {
  setup();
  await using screen = await render(view(card()));
  await expect.element(screen.getByRole("button", { name: "Connect" })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Not now" })).toBeVisible();

  // The user connected Linear in Settings without turning it on for this bot.
  mocks.live.connections = [linear];
  await screen.rerender(view(card()));
  await userEvent.click(screen.getByRole("button", { name: "Turn on for Ada" }));
  expect(mocks.answer).toHaveBeenCalledExactlyOnceWith({
    environmentId,
    input: {
      threadId: ThreadId.make("thread-ada"),
      turnItemId: TurnItemId.make("turn-item:connection-request:1"),
      answer: { type: "use-existing", connectionId: linearId },
    },
  });

  // The answer closes the card and the bot's shell lists the connection.
  mocks.live.botConnectionIds = [linearId];
  const answered = card({ connectionStatus: "connected", connectionId: linearId });
  await screen.rerender(view(answered));
  await expect.element(screen.getByText("Linear connected")).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Not now" })).not.toBeInTheDocument();

  // Turned off later: the card offers it again, now without answering the closed record.
  mocks.live.botConnectionIds = [];
  await screen.rerender(view(answered));
  await userEvent.click(screen.getByRole("button", { name: "Turn on for Ada" }));
  expect(mocks.setBot).toHaveBeenCalledExactlyOnceWith({
    environmentId,
    input: { projectId: ProjectId.make("project-ada"), connectionId: linearId, enabled: true },
  });

  mocks.live.connections = [{ ...linear, status: "needs_auth" }];
  mocks.live.botConnectionIds = [linearId];
  await screen.rerender(view(answered));
  await expect.element(screen.getByRole("button", { name: "Sign in again" })).toBeVisible();

  // Removed later.
  mocks.live.connections = [];
  await screen.rerender(view(answered));
  await expect.element(screen.getByText("Disconnected")).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Reconnect" })).toBeVisible();
});

it("declines with Not now and then says so", async () => {
  setup();
  await using screen = await render(view(card()));
  await userEvent.click(screen.getByRole("button", { name: "Not now" }));
  expect(mocks.answer).toHaveBeenCalledExactlyOnceWith({
    environmentId,
    input: {
      threadId: ThreadId.make("thread-ada"),
      turnItemId: TurnItemId.make("turn-item:connection-request:1"),
      answer: { type: "decline" },
    },
  });
  await screen.rerender(view(card({ connectionStatus: "declined" })));
  await expect.element(screen.getByText("Linear · Declined")).toBeVisible();
});
