import { describe, expect, it } from "vite-plus/test";

import { roomMentionQuery } from "./roomMentions";

const names = ["Chef Bot", "Scout"];

describe("roomMentionQuery", () => {
  it.each([
    ["@", { query: "", start: 0 }],
    ["hi @Sc", { query: "Sc", start: 3 }],
    ["hi @chef b", { query: "chef b", start: 3 }],
    ["hi @Chef Bot", { query: "Chef Bot", start: 3 }],
    ["hi @Scout ", null],
    ["hi @Chef Bot ", null],
    ["mail@Scout", null],
    ["@Sc\nout", null],
    ["no mention", null],
  ])("%j", (text, expected) => {
    expect(roomMentionQuery(text, names)).toEqual(expected);
  });
});
