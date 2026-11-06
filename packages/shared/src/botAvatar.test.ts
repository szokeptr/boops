import {
  BOT_AVATAR_ACCESSORIES,
  BOT_AVATAR_GLOWS,
  BOT_AVATAR_HUES,
  BOT_AVATAR_SHAPES,
  type ProjectAvatar,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { familySpec, lookFor, rerollSpec, specFor } from "./botAvatar.ts";

function family(names: ReadonlyArray<string>): ProjectAvatar[] {
  const looks: ProjectAvatar[] = [];
  for (const name of names) looks.push(familySpec(name, looks));
  return looks;
}

describe("specFor", () => {
  it("seeds the same look from the same name, as the reference sprite engine does", () => {
    expect(specFor("Juniper")).toEqual({
      hue: "tomato",
      accessory: "crown",
      glow: "cyan",
      shape: "onigiri",
    });
    expect(specFor("Juniper")).toEqual(specFor("Juniper"));
    expect(specFor("ada  lovelace!")).toEqual({
      hue: "mint",
      accessory: "none",
      glow: "white",
      shape: "mochi",
    });
  });
});

describe("lookFor", () => {
  it("keeps a stored shape and seeds one from the name for looks saved before shapes", () => {
    const legacy = { hue: "sky", accessory: "bow", glow: "mint" } as const;
    expect(lookFor(legacy, "Juniper")).toEqual({ ...legacy, shape: "onigiri" });
    expect(lookFor({ ...legacy, shape: "ghost" }, "Juniper").shape).toBe("ghost");
    expect(lookFor(null, "Juniper")).toEqual(specFor("Juniper"));
  });
});

describe("familySpec", () => {
  it("matches the reference cast, avoiding taken hues, accessories, and shapes while any are free", () => {
    const names = ["Juniper", "Inbox Ranger", "Gym Buddy", "Newsie", "Ledger", "Pip"];
    expect(family(names)).toEqual([
      { hue: "tomato", accessory: "crown", glow: "cyan", shape: "onigiri" },
      { hue: "grape", accessory: "handle", glow: "mint", shape: "ghost" },
      { hue: "periwinkle", accessory: "phones", glow: "cyan", shape: "gumdrop" },
      { hue: "bubblegum", accessory: "sprout", glow: "mint", shape: "mochi" },
      { hue: "butter", accessory: "bow", glow: "white", shape: "box" },
      { hue: "teal", accessory: "rabbit", glow: "mint", shape: "drop" },
    ]);
  });

  it("keeps every hue and accessory pair distinct once hues and accessories run out", () => {
    const looks = family(Array.from({ length: 96 }, (_, i) => `bot ${i}`));
    expect(new Set(looks.map((look) => look.hue)).size).toBe(BOT_AVATAR_HUES.length);
    expect(new Set(looks.slice(0, 8).map((look) => look.accessory)).size).toBe(8);
    expect(new Set(looks.slice(0, 8).map((look) => look.shape)).size).toBe(
      BOT_AVATAR_SHAPES.length,
    );
    expect(new Set(looks.map((look) => `${look.hue}/${look.accessory}`)).size).toBe(96);
  });
});

describe("rerollSpec", () => {
  it("stays in range, changes the look, and avoids siblings' hues, accessories, and shapes", () => {
    const siblings = family(["Juniper", "Inbox Ranger", "Gym Buddy"]);
    let current = specFor("Fern");
    let seed = 7;
    const random = () => {
      seed = (seed * 48271) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 50; i++) {
      const next = rerollSpec(current, siblings, random);
      expect(BOT_AVATAR_HUES).toContain(next.hue);
      expect(BOT_AVATAR_ACCESSORIES).toContain(next.accessory);
      expect(BOT_AVATAR_GLOWS).toContain(next.glow);
      expect(BOT_AVATAR_SHAPES).toContain(next.shape);
      expect(next).not.toEqual(current);
      expect(siblings.map((sibling) => sibling.hue)).not.toContain(next.hue);
      expect(siblings.map((sibling) => sibling.accessory)).not.toContain(next.accessory);
      expect(siblings.map((sibling) => sibling.shape)).not.toContain(next.shape);
      current = next;
    }
  });
});
