import { describe, expect, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";

import { withBotMessageHeader } from "./botMessageHeader.ts";

const context = (relation: "parent" | "child") => ({
  version: 1 as const,
  records: [],
  bot: { projectId: ProjectId.make("wren"), name: "Wren", relation },
});

describe("withBotMessageHeader", () => {
  it("names the sender and the tool that answers it", () => {
    expect(withBotMessageHeader("How was the run?", context("parent"))).toBe(
      "[From Wren, your parent bot. Answer with report_to_parent.]\n\nHow was the run?",
    );
    expect(withBotMessageHeader("Dana ran 14 km.", context("child"))).toBe(
      "[From Wren, a bot you created. Answer with message_child_bot.]\n\nDana ran 14 km.",
    );
  });

  it("leaves other messages alone", () => {
    expect(withBotMessageHeader("hi", undefined)).toBe("hi");
    expect(withBotMessageHeader("hi", { version: 1, records: [] })).toBe("hi");
  });
});
