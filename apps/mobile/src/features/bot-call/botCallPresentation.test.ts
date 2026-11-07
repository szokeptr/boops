import { describe, expect, it } from "vite-plus/test";

import { callRecapLabel, callRecapLines, formatCallDuration } from "./botCallPresentation";

describe("call presentation", () => {
  it("formats the call timer", () => {
    expect([0, 42, 725, 3723].map(formatCallDuration)).toEqual([
      "0:00",
      "0:42",
      "12:05",
      "1:02:03",
    ]);
  });

  it("labels a finished call by its length", () => {
    expect(callRecapLabel(undefined)).toBe("Call");
    expect(callRecapLabel(20)).toBe("Call · under a minute");
    expect(callRecapLabel(250)).toBe("Call · 4 min");
    expect(callRecapLabel(250, 2)).toBe("Call · 4 min · 2 requests");
  });

  it("splits a transcript back into who said what", () => {
    expect(
      callRecapLines("…User: hey Wren\nWren: Hey! Booked it.\nAnything else?\nUser: no, thanks"),
    ).toEqual([
      { speaker: "user", name: "You", text: "hey Wren" },
      { speaker: "bot", name: "Wren", text: "Hey! Booked it.\nAnything else?" },
      { speaker: "user", name: "You", text: "no, thanks" },
    ]);
  });
});
