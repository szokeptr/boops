import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { act, render } from "../../test/render";

const state = vi.hoisted(() => ({
  navigate: vi.fn(),
  createBot: vi.fn(),
  setup() {
    state.navigate.mockReset().mockResolvedValue(undefined);
    state.createBot.mockReset();
  },
}));

const LAPTOP = EnvironmentId.make("laptop");
const SERVER = EnvironmentId.make("server");

vi.mock(import("@tanstack/react-router"), async (original) => ({
  ...(await original()),
  useNavigate: (() => state.navigate) as never,
}));
vi.mock(import("../state/use-atom-command"), () => ({
  useAtomCommand: (() => state.createBot) as never,
}));
vi.mock(import("../state/environments"), async (original) => ({
  ...(await original()),
  usePrimaryEnvironmentId: (() => EnvironmentId.make("laptop")) as never,
  useEnvironments: (() => ({
    environments: ["laptop", "server"].map((id) => ({
      environmentId: id,
      label: id === "laptop" ? "Laptop" : "Server",
      connection: { phase: "connected" },
      serverConfig: { environment: { platform: { os: "linux" } } },
    })),
  })) as never,
}));
vi.mock(import("../state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentsWithScope: (() => new Set(["laptop", "server"])) as never,
}));
vi.mock(import("../state/entities"), async (original) => ({
  ...(await original()),
  waitForThreadShell: (() => Promise.resolve(true)) as never,
}));
// Each machine has its own default model, so the submitted model shows which machine was used.
vi.mock(import("../hooks/useSettings"), async (original) => ({
  ...(await original()),
  useEnvironmentSettings: ((environmentId: string) => ({ environmentId })) as never,
}));
vi.mock(import("./settings/scheduledTasksSettings.logic"), async (original) => ({
  ...(await original()),
  scheduledTaskDefaultModel: ((settings: { environmentId: string }) => ({
    instanceId: "codex",
    model: `${settings.environmentId}-default`,
  })) as never,
}));
vi.mock(import("./chat/ProviderModelPicker"), async (original) => ({
  ...(await original()),
  ProviderModelPicker: ((props: {
    model: string;
    onInstanceModelChange: (instanceId: string, model: string) => void;
  }) => (
    <button type="button" onClick={() => props.onInstanceModelChange("claude", "haiku")}>
      Model: {props.model}
    </button>
  )) as never,
}));

import { CreateBotDialogHost, openCreateBotDialog } from "./CreateBotDialog";

async function createAda(screen: Awaited<ReturnType<typeof render>>) {
  await act(() => openCreateBotDialog());
  await userEvent.fill(screen.getByLabelText("Name"), "Ada");
}

describe("CreateBotDialog", () => {
  it("creates the bot with the picked model and opens its main thread", async () => {
    state.setup();
    state.createBot.mockResolvedValue({
      _tag: "Success",
      value: { projectId: "bot", mainThreadId: ThreadId.make("bot-main") },
    });
    await using screen = await render(<CreateBotDialogHost />);

    await createAda(screen);
    await userEvent.click(screen.getByRole("button", { name: "Model: laptop-default" }));
    await userEvent.type(screen.getByLabelText("Name"), "{Enter}");

    await vi.waitFor(() => expect(state.navigate).toHaveBeenCalledOnce());
    expect(state.createBot).toHaveBeenCalledWith({
      environmentId: LAPTOP,
      input: {
        name: "Ada",
        modelSelection: { instanceId: ProviderInstanceId.make("claude"), model: "haiku" },
      },
    });
    expect(state.navigate).toHaveBeenCalledWith({
      to: "/$environmentId/$threadId",
      params: { environmentId: LAPTOP, threadId: "bot-main" },
    });
    await expect.element(screen.getByText("New bot")).not.toBeInTheDocument();
  });

  it("creates the bot on the machine picked with several connected", async () => {
    state.setup();
    state.createBot.mockResolvedValue({
      _tag: "Success",
      value: { projectId: "bot", mainThreadId: ThreadId.make("bot-main") },
    });
    await using screen = await render(<CreateBotDialogHost />);

    await createAda(screen);
    await userEvent.click(screen.getByLabelText("Machine"));
    await userEvent.click(screen.getByRole("option", { name: "Server" }));
    await userEvent.type(screen.getByLabelText("Name"), "{Enter}");

    await vi.waitFor(() => expect(state.navigate).toHaveBeenCalledOnce());
    expect(state.createBot).toHaveBeenCalledWith({
      environmentId: SERVER,
      input: { name: "Ada", modelSelection: { instanceId: "codex", model: "server-default" } },
    });
    expect(state.navigate).toHaveBeenCalledWith({
      to: "/$environmentId/$threadId",
      params: { environmentId: SERVER, threadId: "bot-main" },
    });
  });
});
