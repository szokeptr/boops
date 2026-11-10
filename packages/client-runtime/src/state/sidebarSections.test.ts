import { EnvironmentId, SidebarSectionId, type SidebarLayout } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  addSidebarSection,
  chooseSidebarLayoutHome,
  moveSidebarSection,
  organizeSidebar,
  placeSidebarItem,
  removeSidebarSection,
} from "./sidebarSections.ts";

const work = SidebarSectionId.make("work");
const home = SidebarSectionId.make("home");
const layout: SidebarLayout = {
  sections: [
    { id: work, title: "Work", collapsed: false, items: ["bot:a", "bot:offline", "room:c"] },
    { id: home, title: "Home", collapsed: true, items: ["bot:a", "bot:b"] },
  ],
};
const item = (sidebarKey: string) => ({ sidebarKey });

describe("organizeSidebar", () => {
  it("fills sections in placed order, once each, and leaves the rest in input order", () => {
    const result = organizeSidebar(layout, ["bot:d", "bot:b", "room:c", "bot:a"].map(item));
    expect(result.sections.map((entry) => entry.items.map((it) => it.sidebarKey))).toEqual([
      ["bot:a", "room:c"],
      ["bot:b"],
    ]);
    expect(result.unsorted.map((it) => it.sidebarKey)).toEqual(["bot:d"]);
  });
});

describe("placeSidebarItem", () => {
  it("moves an item before another, keeping keys this client cannot see", () => {
    expect(
      placeSidebarItem(layout, "bot:b", { sectionId: work, beforeKey: "room:c" }).sections.map(
        (section) => section.items,
      ),
    ).toEqual([["bot:a", "bot:offline", "bot:b", "room:c"], ["bot:a"]]);
  });

  it("appends when the anchor is gone and returns to the default lists without a section", () => {
    const appended = placeSidebarItem(layout, "bot:d", { sectionId: home, beforeKey: "bot:x" });
    expect(appended.sections[1]?.items).toEqual(["bot:a", "bot:b", "bot:d"]);
    expect(placeSidebarItem(layout, "bot:a", null).sections.map((s) => s.items)).toEqual([
      ["bot:offline", "room:c"],
      ["bot:b"],
    ]);
  });
});

describe("sections", () => {
  it("adds a section that takes its items from others, moves and removes sections", () => {
    const fun = SidebarSectionId.make("fun");
    const added = addSidebarSection(layout, { id: fun, title: "Fun" }, ["room:c"]);
    expect(added.sections.map((section) => [section.id, section.items])).toEqual([
      [work, ["bot:a", "bot:offline"]],
      [home, ["bot:a", "bot:b"]],
      [fun, ["room:c"]],
    ]);
    expect(moveSidebarSection(added, fun, 0).sections.map((section) => section.id)).toEqual([
      fun,
      work,
      home,
    ]);
    expect(moveSidebarSection(added, work, 99).sections.map((section) => section.id)).toEqual([
      home,
      fun,
      work,
    ]);
    expect(removeSidebarSection(added, home).sections.map((section) => section.id)).toEqual([
      work,
      fun,
    ]);
  });
});

describe("chooseSidebarLayoutHome", () => {
  it("prefers the first environment with sections, then the first that answered", () => {
    const a = EnvironmentId.make("env-a");
    const b = EnvironmentId.make("env-b");
    const c = EnvironmentId.make("env-c");
    const empty: SidebarLayout = { sections: [] };
    expect(
      chooseSidebarLayoutHome([
        { environmentId: c, layout },
        { environmentId: a, layout: empty },
        { environmentId: b, layout },
      ])?.environmentId,
    ).toBe(b);
    expect(
      chooseSidebarLayoutHome([
        { environmentId: b, layout: empty },
        { environmentId: a, layout: null },
      ])?.environmentId,
    ).toBe(b);
    expect(chooseSidebarLayoutHome([{ environmentId: a, layout: null }])).toBeNull();
  });
});
