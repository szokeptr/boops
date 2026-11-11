import { ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { pickBot, type RouteCandidate } from "./RoomRouter.ts";

const scout = ProjectId.make("project:scout");
const chef = ProjectId.make("project:chef");
const candidate = (projectId: ProjectId, followUp: boolean): RouteCandidate => ({
  projectId,
  name: projectId,
  listensFor: null,
  followUp,
});

describe("pickBot", () => {
  it.each([
    { name: "the likeliest bot", scout: 0.4, chef: 0.8, expected: chef },
    { name: "nobody below the wake line", scout: 0.2, chef: 0.1, expected: undefined },
    { name: "the follow-up on a tie", scout: 0.6, chef: 0.6, expected: scout },
  ])("wakes $name", ({ scout: scoutScore, chef: chefScore, expected }) => {
    const candidates = [candidate(chef, false), candidate(scout, true)];
    const scores = [
      { projectId: chef, probability: chefScore },
      { projectId: scout, probability: scoutScore },
    ];
    expect(pickBot(scores, candidates)).toBe(expected);
  });
});
