import { ProjectId } from "./baseSchemas.ts";
import { mentionedBots, roomMentionSegments } from "./rooms.ts";
import { describe, expect, it } from "@effect/vitest";

const chef = ProjectId.make("chef");
const chefBot = ProjectId.make("chef-bot");
const scout = ProjectId.make("scout");
const bots = [
  { projectId: chef, name: "Chef" },
  { projectId: chefBot, name: "Chef Bot" },
  { projectId: scout, name: "Scout" },
];

describe("mentionedBots", () => {
  it.each([
    ["@chef can you cook?", [chef]],
    ["Ask @Scout and @Chef.", [scout, chef]],
    ["@Chef Bot, over to you", [chefBot]],
    ["mail me at me@chef.dev", []],
    ["@Chefs are busy", []],
    ["no mention of Chef here", []],
    ["@Chef Bot first, @Chef Bot again", [chefBot]],
  ])("%s", (text, expected) => {
    expect(mentionedBots(text, bots)).toEqual(expected);
  });
});

describe("roomMentionSegments", () => {
  const names = ["Scout", "Scout Pro", "Chef Bot"];
  it.each([
    ["no mentions", [{ text: "no mentions" }]],
    [
      "hey @chef bot!",
      [{ text: "hey " }, { text: "@chef bot", mention: "Chef Bot" }, { text: "!" }],
    ],
    ["@Scout, thoughts?", [{ text: "@Scout", mention: "Scout" }, { text: ", thoughts?" }]],
    ["@Scouting is plain", [{ text: "@Scouting is plain" }]],
    ["over to @Scout Pro", [{ text: "over to " }, { text: "@Scout Pro", mention: "Scout Pro" }]],
    [
      "@Scout Profile and @Scout Pro",
      [
        { text: "@Scout", mention: "Scout" },
        { text: " Profile and " },
        { text: "@Scout Pro", mention: "Scout Pro" },
      ],
    ],
    [
      "@Scout then @Chef Bot",
      [
        { text: "@Scout", mention: "Scout" },
        { text: " then " },
        { text: "@Chef Bot", mention: "Chef Bot" },
      ],
    ],
    ["me@scout.dev", [{ text: "me@scout.dev" }]],
    ["İ @Scout", [{ text: "İ " }, { text: "@Scout", mention: "Scout" }]],
  ])("%s", (text, expected) => {
    const segments = roomMentionSegments(text, names);
    expect(segments.map(({ start: _start, ...segment }) => segment)).toEqual(expected);
    for (const segment of segments) {
      expect(text.slice(segment.start, segment.start + segment.text.length)).toBe(segment.text);
    }
  });

  it("marks exactly the bots mentionedBots sends", () => {
    const roomBots = names.map((name) => ({ projectId: ProjectId.make(name), name }));
    for (const text of ["@Scout Profile and @Scout Pro", "@scout pro.", "@Chef Bot @Chef Bots"]) {
      const marked = roomMentionSegments(text, names).flatMap((segment) =>
        segment.mention === undefined ? [] : [ProjectId.make(segment.mention)],
      );
      expect(new Set(marked)).toEqual(new Set(mentionedBots(text, roomBots)));
    }
  });
});
