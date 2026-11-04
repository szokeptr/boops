import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { botRowDetail } from "./bot-destinations";

const environmentId = EnvironmentId.make("environment-vps");
const projectId = ProjectId.make("scout");

describe("botRowDetail", () => {
  it("opens the bot's main thread, or starts a conversation in its project when it has none", () => {
    expect(
      botRowDetail(
        { environmentId, projectId, name: "Scout", mainThreadId: ThreadId.make("scout-main") },
        "request-1",
      ),
    ).toEqual({
      name: "Thread",
      params: { environmentId: "environment-vps", threadId: "scout-main" },
    });
    expect(
      botRowDetail({ environmentId, projectId, name: "Scout", mainThreadId: null }, "request-1"),
    ).toEqual({
      name: "Thread",
      params: {
        draft: {
          requestId: "request-1",
          environmentId: "environment-vps",
          projectId: "scout",
          title: "Scout",
        },
      },
    });
  });
});
