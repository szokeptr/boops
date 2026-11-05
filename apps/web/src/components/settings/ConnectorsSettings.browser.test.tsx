import {
  type ConnectorConnection,
  ConnectorConnectionId,
  EnvironmentId,
  ProjectId,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";

const mocks = vi.hoisted(() => ({ remove: vi.fn(), linearId: "connection-linear" }));

const linearId = ConnectorConnectionId.make(mocks.linearId);

vi.mock(import("~/state/connectors"), async () => {
  const { Atom } = await import("effect/reactivity");
  const allowed = Atom.make(true);
  const command = (label: string) => ({ label, permissionAtom: () => allowed });
  const linearId = ConnectorConnectionId.make(mocks.linearId);
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
  const bot = (id: string, title: string, connectionIds: ReadonlyArray<string>) => ({
    id: ProjectId.make(id),
    title,
    connectionIds,
  });
  return {
    connectorEnvironment: Object.fromEntries(
      [
        "remove",
        "test",
        "disconnect",
        "rename",
        "startOAuth",
        "detectAuth",
        "addConnection",
        "reauthenticate",
        "setBotConnection",
      ].map((name) => [name, command(name)]),
    ) as never,
    useConnectorConnections: () => ({ connections: [linear], loaded: true, error: null }),
    useConnectorCatalog: () => ({ entries: [], error: null, isPending: false }),
    useConnectorRedirect: () => ({ origin: "http://localhost:3773", insecureRemote: false }),
    useEnvironmentBots: (() => [
      bot("project-ada", "Ada", [linearId]),
      bot("project-bo", "Bo", []),
      bot("project-cy", "Cy", [linearId]),
    ]) as never,
  };
});
vi.mock(import("~/state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: ((command: { label: string }) =>
    command.label === "remove" ? mocks.remove : vi.fn()) as never,
}));
vi.mock(import("./SettingsScopeContext"), async (original) => ({
  ...(await original()),
  useSettingsScope: (() => ({
    environment: {
      environmentId: EnvironmentId.make("environment-local"),
      label: "This Mac",
      connection: { phase: "connected" },
    },
  })) as never,
}));

import { ConnectorsSettingsPanel } from "./ConnectorsSettings";

function setup() {
  mocks.remove.mockReset().mockResolvedValue(AsyncResult.success(undefined));
}

it("names the bots a removal turns the connection off for", async () => {
  setup();
  await using screen = await render(<ConnectorsSettingsPanel />);
  await userEvent.click(screen.getByRole("button", { name: "Actions for Linear" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Remove…" }));

  const dialog = screen.getByRole("alertdialog");
  await expect.element(dialog).toBeVisible();
  const text = dialog.element().textContent;
  expect(text).toContain("It turns off for Ada, Cy,");
  expect(text).not.toMatch(/\bBo\b/);
  expect(mocks.remove).not.toHaveBeenCalled();

  // Base UI's modal backdrop sits over the popup for the pointer, as in ThreadDetailsPrRow's test.
  await act(async () => {
    (dialog.getByRole("button", { name: "Remove" }).element() as HTMLButtonElement).click();
  });
  expect(mocks.remove).toHaveBeenCalledExactlyOnceWith({
    environmentId: EnvironmentId.make("environment-local"),
    input: { connectionId: linearId },
  });
});
