import { ProjectId } from "./baseSchemas.ts";
import { mentionedBots } from "./rooms.ts";
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
  ])("%s", (text, expected) => {
    expect(mentionedBots(text, bots)).toEqual(expected);
  });
});
