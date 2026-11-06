import { botHeartbeatThreadId, EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { makeThreadFixture } from "../../test-fixtures";
import { BotActivityView } from "./BotActivity";

const environmentId = EnvironmentId.make("environment-vps");
const projectId = ProjectId.make("scout");

function botThread(id: string, title: string, createdAt: string, helper = false) {
  return makeThreadFixture({
    environmentId,
    projectId,
    id: ThreadId.make(id),
    title,
    createdAt,
    ...(helper
      ? {
          lineage: {
            rootThreadId: ThreadId.make("main"),
            parentThreadId: ThreadId.make("main"),
            relationshipToParent: "subagent" as const,
          },
        }
      : {}),
  });
}

describe("BotActivityView", () => {
  it("lists the bot's background threads, not its conversations, and opens one", async () => {
    await using screen = await render(
      <BotActivityView
        project={{
          environmentId,
          id: projectId,
          title: "Scout",
          workspaceRoot: "/bots/scout",
          defaultModelSelection: null,
          scripts: [],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }}
        threads={[
          botThread(botHeartbeatThreadId(projectId), "Heartbeat", "2026-01-03T00:00:00.000Z"),
          botThread("main", "Scout", "2026-01-01T00:00:00.000Z"),
          botThread("chat", "Trip planning", "2026-01-04T00:00:00.000Z"),
          botThread("child", "Price check", "2026-01-02T00:00:00.000Z", true),
        ]}
      />,
    );

    const activity = screen.getByRole("list", { name: "Scout activity" });
    await expect.element(activity.getByRole("link")).toHaveLength(2);
    await expect.element(activity.getByRole("link", { name: /Heartbeat/ })).toBeVisible();
    await expect.element(activity.getByRole("link", { name: /Price check/ })).toBeVisible();

    await userEvent.click(activity.getByRole("link", { name: /Price check/ }));
    await vi.waitFor(() =>
      expect(screen.router?.state.location.pathname).toBe(`/${environmentId}/child`),
    );
  });
});
