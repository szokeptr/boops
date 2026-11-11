import type { OrchestrationV2MessageReaction, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { firstEmoji, groupMessageReactions, messageReactionLabel } from "./messageReactions.ts";

const bot = (name: string) => ({
  kind: "bot" as const,
  projectId: name.toLowerCase() as ProjectId,
  name,
});

describe("messageReactions", () => {
  it("groups by emoji in first-chosen order and puts the user first", () => {
    const reactions: ReadonlyArray<OrchestrationV2MessageReaction> = [
      { emoji: "👍", by: bot("Pixel"), at: "2026-11-11T10:00:02.000Z" },
      { emoji: "❤️", by: bot("Nova"), at: "2026-11-11T10:00:00.000Z" },
      { emoji: "❤️", by: { kind: "user" }, at: "2026-11-11T10:00:01.000Z" },
    ];
    const groups = groupMessageReactions(reactions);
    expect(groups).toEqual([
      { emoji: "❤️", count: 2, mine: true, names: ["You", "Nova"] },
      { emoji: "👍", count: 1, mine: false, names: ["Pixel"] },
    ]);
    expect(messageReactionLabel(groups[0]!)).toBe("You and Nova reacted with ❤️");
  });

  it("extracts one complete emoji grapheme", () => {
    expect(firstEmoji("  👩🏽‍💻 hello")).toBe("👩🏽‍💻");
    expect(firstEmoji("🇺🇸 project")).toBe("🇺🇸");
    expect(firstEmoji("1️⃣ project")).toBe("1️⃣");
    expect(firstEmoji("❤️")).toBe("❤️");
    expect(firstEmoji("👍🏽 ok")).toBe("👍🏽");
    expect(firstEmoji("plain text")).toBeNull();
  });
});
