import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";

const state = vi.hoisted(() => ({
  navigate: vi.fn(),
  deleteBot: vi.fn(),
  setup() {
    state.navigate.mockReset().mockResolvedValue(undefined);
    state.deleteBot.mockReset().mockResolvedValue({ _tag: "Success", value: undefined });
  },
}));

vi.mock(import("@tanstack/react-router"), async (original) => ({
  ...(await original()),
  useNavigate: (() => state.navigate) as never,
}));
vi.mock(import("../../state/use-atom-command"), () => ({
  useAtomCommand: (() => state.deleteBot) as never,
}));

import { DeleteBotDialogHost, openDeleteBotDialog } from "./BotLifecycle";

const bot = {
  environmentId: EnvironmentId.make("laptop"),
  projectId: ProjectId.make("ledger"),
  name: "Ledger",
};

describe("DeleteBotDialog", () => {
  it("deletes only once the bot's name is typed, keeping its folder by default", async () => {
    state.setup();
    await using screen = await render(<DeleteBotDialogHost />);

    await act(() => openDeleteBotDialog(bot));
    const remove = screen.getByRole("button", { name: "Delete bot" });
    await userEvent.fill(screen.getByLabelText("Type Ledger to confirm"), "Ledg");
    await expect.element(remove).toBeDisabled();
    await userEvent.fill(screen.getByLabelText("Type Ledger to confirm"), "Ledger");
    await expect.element(remove).toBeEnabled();
    await userEvent.type(screen.getByLabelText("Type Ledger to confirm"), "{Enter}");

    await vi.waitFor(() => expect(state.navigate).toHaveBeenCalledOnce());
    expect(state.deleteBot).toHaveBeenCalledWith({
      environmentId: bot.environmentId,
      input: { projectId: bot.projectId },
    });
  });

  it("removes the home folder only when its checkbox is ticked", async () => {
    state.setup();
    await using screen = await render(<DeleteBotDialogHost />);

    await act(() => openDeleteBotDialog(bot));
    await userEvent.fill(screen.getByLabelText("Type Ledger to confirm"), "Ledger");
    await userEvent.click(screen.getByText("Also delete its home folder"));
    await userEvent.type(screen.getByLabelText("Type Ledger to confirm"), "{Enter}");
    await vi.waitFor(() => expect(state.deleteBot).toHaveBeenCalledOnce());
    expect(state.deleteBot).toHaveBeenCalledWith({
      environmentId: bot.environmentId,
      input: { projectId: bot.projectId, removeHomeFolder: true },
    });
  });
});
