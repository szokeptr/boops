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
  setBotAccess: vi.fn(),
  invite: vi.fn(),
  setup() {
    mocks.setBotAccess.mockReset().mockResolvedValue(AsyncResult.success(undefined));
    mocks.invite.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  },
}));

vi.mock(import("~/state/members"), async () => {
  const { Atom } = await import("effect/reactivity");
  const allowed = Atom.make(true);
  const command = (label: string) => ({ label, permissionAtom: () => allowed });
  const member = (id: string, label: string): EnvironmentMember => ({
    id: EnvironmentMemberId.make(id),
    label,
    email: `${label.toLowerCase()}@example.com`,
    access: "auto-accept-edits",
    status: "active",
    createdAt: "2026-11-01T10:00:00.000Z",
    lastConnectedAt: null,
  });
  return {
    memberEnvironment: {
      setBotAccess: command("setBotAccess"),
      setBotConnectionAccess: command("setBotConnectionAccess"),
      invite: command("invite"),
      remove: command("remove"),
    } as never,
    useMembers: () => ({
      allowed: true,
      members: [member("member-anna", "Anna"), member("member-ben", "Ben")],
      canInvite: true,
      loaded: true,
      error: null,
    }),
  };
});
vi.mock(import("~/state/connectors"), async (original) => ({
  ...(await original()),
  useConnectorConnections: () => ({ connections: [], loaded: true, error: null }),
}));
vi.mock(import("~/state/entities"), async (original) => ({
  ...(await original()),
  useProjects: (() => [
    {
      environmentId: "environment-local",
      id: ProjectId.make("project-ada"),
      title: "Ada",
      memberIds: ["member-anna"],
    },
  ]) as never,
}));
vi.mock(import("~/state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: ((command: { label: string }) =>
    command.label === "setBotAccess"
      ? mocks.setBotAccess
      : command.label === "invite"
        ? mocks.invite
        : vi.fn()) as never,
}));

import { openShareBotDialog, ShareBotDialogHost } from "./ShareBotDialog";

const environmentId = EnvironmentId.make("environment-local");
const bot = { environmentId, projectId: ProjectId.make("project-ada"), name: "Ada" };

it("shares and unshares the bot with the member whose switch flips", async () => {
  mocks.setup();
  await using screen = await render(<ShareBotDialogHost />);
  await act(() => openShareBotDialog(bot));

  const anna = screen.getByRole("switch", { name: "Share with Anna" });
  const ben = screen.getByRole("switch", { name: "Share with Ben" });
  await expect.element(anna).toBeChecked();
  await expect.element(ben).not.toBeChecked();

  // Test pages load no stylesheet, so the empty switch has no box for the pointer.
  await act(() => (ben.element() as HTMLElement).click());
  expect(mocks.setBotAccess).toHaveBeenLastCalledWith({
    environmentId,
    input: { projectId: bot.projectId, memberId: "member-ben", enabled: true },
  });
  await act(() => (anna.element() as HTMLElement).click());
  expect(mocks.setBotAccess).toHaveBeenLastCalledWith({
    environmentId,
    input: { projectId: bot.projectId, memberId: "member-anna", enabled: false },
  });
});

it("invites only a named person with a real email, sharing this bot", async () => {
  mocks.setup();
  await using screen = await render(<ShareBotDialogHost />);
  await act(() => openShareBotDialog(bot));
  const submit = screen.getByRole("button", { name: "Invite and share Ada" });

  await userEvent.click(submit);
  await expect.element(screen.getByRole("alert")).toHaveTextContent("Add their name.");
  await userEvent.fill(screen.getByLabelText("Name"), "  Cleo ");
  await userEvent.fill(screen.getByLabelText("Email"), "cleo@");
  await userEvent.click(submit);
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("Enter the email they sign in with.");
  expect(mocks.invite).not.toHaveBeenCalled();

  await userEvent.fill(screen.getByLabelText("Email"), " cleo@example.com ");
  await userEvent.click(submit);
  expect(mocks.invite).toHaveBeenCalledExactlyOnceWith({
    environmentId,
    input: { label: "Cleo", email: "cleo@example.com", projectIds: [bot.projectId] },
  });
  await expect.element(screen.getByLabelText("Name")).toHaveValue("");
});
