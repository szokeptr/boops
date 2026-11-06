import { describe, expect, it } from "@effect/vitest";

import { isMemberEnvironment } from "./members.ts";

const member = { member: { id: "member-1", label: "Anna" } };

describe("isMemberEnvironment", () => {
  it.each([
    ["a member session", member, undefined, true],
    ["an owner session, whatever the link says", {}, "member", false],
    ["a member link while the session loads", null, "member", true],
    ["an owner link while the session loads", null, "owner", false],
    ["no link and no session", null, undefined, false],
  ] as const)("%s", (_case, session, relayRole, expected) => {
    expect(isMemberEnvironment({ session, relayRole })).toBe(expected);
  });
});
