import type { BotRow } from "@t3tools/client-runtime/state/bot-list";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { BotList } from "./BotList";

const environmentId = EnvironmentId.make("environment-vps");

function botRow(overrides: Partial<BotRow> = {}): BotRow {
  return {
    key: `${environmentId}:scout`,
    environmentId,
    machineLabel: "VPS",
    projectId: ProjectId.make("scout"),
    name: "Scout",
    avatar: null,
    mainThreadId: ThreadId.make("scout-main"),
    lastMessagePreview: "Found three flights",
    lastMessageFromUser: false,
    status: "idle",
    unread: false,
    lastActivityAt: "2026-06-01T00:00:00.000Z",
    activityThreadCount: 2,
    ...overrides,
  };
}

describe("BotList", () => {
  it("opens a bot's main thread, or starts one when it has none", async () => {
    const onStartConversation = vi.fn();
    const fresh = botRow({
      key: `${environmentId}:fresh`,
      projectId: ProjectId.make("fresh"),
      name: "Fresh",
      mainThreadId: null,
      lastMessagePreview: null,
      activityThreadCount: 0,
    });
    await using screen = await render(
      <BotList
        rows={[botRow(), fresh]}
        activeKey={null}
        showMachineBadges
        machineKindById={new Map()}
        onStartConversation={onStartConversation}
      />,
    );

    await userEvent.click(screen.getByRole("link", { name: "Scout, Found three flights" }));
    await vi.waitFor(() =>
      expect(screen.router?.state.location.pathname).toBe(`/${environmentId}/scout-main`),
    );

    await userEvent.click(screen.getByRole("link", { name: "Scout activity (2)" }));
    await vi.waitFor(() =>
      expect(screen.router?.state.location.pathname).toBe(`/bots/${environmentId}/scout/activity`),
    );

    await userEvent.click(screen.getByRole("button", { name: "Fresh" }));
    expect(onStartConversation).toHaveBeenCalledWith(fresh);
  });
});
