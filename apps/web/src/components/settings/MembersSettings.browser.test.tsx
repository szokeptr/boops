import {
  type EnvironmentMember,
  EnvironmentId,
  EnvironmentMemberId,
  ProjectId,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";

const mocks = vi.hoisted(() => ({
  remove: vi.fn(),
  setBotAccess: vi.fn(),
  setup() {
    mocks.remove.mockReset().mockResolvedValue(AsyncResult.success(undefined));
    mocks.setBotAccess.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  },
}));

const anna: EnvironmentMember = {
  id: EnvironmentMemberId.make("member-anna"),
  label: "Anna",
  email: "anna@example.com",
  access: "auto-accept-edits",
  status: "invited",
  createdAt: "2026-11-01T10:00:00.000Z",
  lastConnectedAt: null,
};

vi.mock(import("~/state/members"), async () => {
  const { Atom } = await import("effect/reactivity");
  const allowed = Atom.make(true);
  const command = (label: string) => ({ label, permissionAtom: () => allowed });
  return {
    memberEnvironment: {
      setBotAccess: command("setBotAccess"),
      setBotConnectionAccess: command("setBotConnectionAccess"),
      invite: command("invite"),
      remove: command("remove"),
    } as never,
    useMembers: () => ({
      allowed: true,
      members: [anna],
      canInvite: true,
      loaded: true,
      error: null,
    }),
  };
});
vi.mock(import("~/state/connectors"), async (original) => ({
  ...(await original()),
  useEnvironmentBots: (() =>
    [
      { id: "project-ada", title: "Ada", memberIds: [anna.id] },
      { id: "project-bo", title: "Bo", memberIds: [] },
    ].map((bot) => ({
      ...bot,
      environmentId: "environment-local",
      workspaceRoot: `/bots/${bot.title}`,
    }))) as never,
}));
vi.mock(import("~/state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: ((command: { label: string }) =>
    command.label === "remove"
      ? mocks.remove
      : command.label === "setBotAccess"
        ? mocks.setBotAccess
        : vi.fn()) as never,
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

import { MembersSettingsPanel } from "./MembersSettings";

const environmentId = EnvironmentId.make("environment-local");

it("shares a bot from its chip and removes a person only once confirmed", async () => {
  mocks.setup();
  await using screen = await render(<MembersSettingsPanel />);

  const bo = screen.getByRole("button", { name: "Share Bo with Anna" });
  await expect
    .element(screen.getByRole("button", { name: "Share Ada with Anna" }))
    .toHaveAttribute("aria-pressed", "true");
  await userEvent.click(bo);
  expect(mocks.setBotAccess).toHaveBeenCalledExactlyOnceWith({
    environmentId,
    input: { projectId: ProjectId.make("project-bo"), memberId: anna.id, enabled: true },
  });

  await userEvent.click(screen.getByRole("button", { name: "Remove…" }));
  const dialog = screen.getByRole("alertdialog");
  await expect.element(dialog).toBeVisible();
  expect(mocks.remove).not.toHaveBeenCalled();
  // Base UI's modal backdrop sits over the popup for the pointer, as in ConnectorsSettings' test.
  await act(async () => {
    (dialog.getByRole("button", { name: "Remove" }).element() as HTMLButtonElement).click();
  });
  expect(mocks.remove).toHaveBeenCalledExactlyOnceWith({
    environmentId,
    input: { memberId: anna.id },
  });
});
