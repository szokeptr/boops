import { describe, expect, it } from "vite-plus/test";

import { BOT_CALL_VOICES } from "@t3tools/contracts";

import { BOT_CALL_VOICE_GROUPS, botCallVoiceLabel, changeBotCallSettings } from "./voices.ts";

describe("changeBotCallSettings", () => {
  it("changes one setting, keeps the other, and clears to defaults when both are reset", () => {
    const hungarian = changeBotCallSettings(null, { language: "Hungarian" });
    expect(hungarian).toEqual({ language: "Hungarian" });
    const stone = changeBotCallSettings(hungarian, { voice: "stone" });
    expect(stone).toEqual({ voice: "stone", language: "Hungarian" });
    expect(changeBotCallSettings(stone, { language: undefined })).toEqual({ voice: "stone" });
    expect(changeBotCallSettings({ voice: "stone" }, { voice: undefined })).toBeNull();
  });
});

it("offers every voice exactly once, labelled with its language when it has one", () => {
  const offered = BOT_CALL_VOICE_GROUPS.flatMap((group) => group.voices.map((item) => item.voice));
  expect(offered.toSorted()).toEqual([...BOT_CALL_VOICES].toSorted());
  expect(botCallVoiceLabel("stone")).toBe("Stone · English, Irish, masculine");
  expect(botCallVoiceLabel("nuri")).toBe("Nuri · German, feminine");
  expect(botCallVoiceLabel("coral")).toBe("Coral");
});
