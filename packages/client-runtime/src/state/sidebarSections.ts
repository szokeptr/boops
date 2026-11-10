import {
  type EnvironmentId,
  type ProjectId,
  type RoomId,
  SIDEBAR_SECTION_TITLE_MAX_LENGTH,
  type SidebarLayout,
  type SidebarSection,
  type SidebarSectionId,
  WS_METHODS,
} from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

export const sidebarBotKey = (environmentId: EnvironmentId, projectId: ProjectId) =>
  `bot:${environmentId}:${projectId}`;

export const sidebarRoomKey = (environmentId: EnvironmentId, roomId: RoomId) =>
  `room:${environmentId}:${roomId}`;

/** A section's title as typed, trimmed and clipped; null when nothing is left. */
export function sidebarSectionTitle(input: string): string | null {
  const title = input.trim().slice(0, SIDEBAR_SECTION_TITLE_MAX_LENGTH).trim();
  return title.length === 0 ? null : title;
}

export interface OrganizedSidebarSection<T> {
  readonly section: SidebarSection;
  readonly items: ReadonlyArray<T>;
}

/**
 * Sorts the visible bots and rooms into the viewer's sections, in the order they were placed.
 * The rest stay in their given order for the default lists. Keys this client cannot see are
 * skipped, not dropped, so a machine that is offline keeps its place.
 */
export function organizeSidebar<T extends { readonly sidebarKey: string }>(
  layout: SidebarLayout,
  items: ReadonlyArray<T>,
): {
  readonly sections: ReadonlyArray<OrganizedSidebarSection<T>>;
  readonly unsorted: ReadonlyArray<T>;
} {
  const byKey = new Map(items.map((item) => [item.sidebarKey, item]));
  const placed = new Set<string>();
  const sections = layout.sections.map((section) => {
    const sectionItems: T[] = [];
    for (const key of section.items) {
      const item = byKey.get(key);
      if (item === undefined || placed.has(key)) continue;
      placed.add(key);
      sectionItems.push(item);
    }
    return { section, items: sectionItems };
  });
  return { sections, unsorted: items.filter((item) => !placed.has(item.sidebarKey)) };
}

const withoutItem = (sections: ReadonlyArray<SidebarSection>, key: string) =>
  sections.map((section) =>
    section.items.includes(key)
      ? { ...section, items: section.items.filter((item) => item !== key) }
      : section,
  );

const updateSection = (
  layout: SidebarLayout,
  sectionId: SidebarSectionId,
  update: (section: SidebarSection) => SidebarSection,
): SidebarLayout => ({
  sections: layout.sections.map((section) =>
    section.id === sectionId ? update(section) : section,
  ),
});

/** A new section at the end, holding `items` taken from wherever they were. */
export function addSidebarSection(
  layout: SidebarLayout,
  section: { readonly id: SidebarSectionId; readonly title: string },
  items: ReadonlyArray<string> = [],
): SidebarLayout {
  const sections = items.reduce(withoutItem, layout.sections);
  return { sections: [...sections, { ...section, collapsed: false, items: [...items] }] };
}

export function renameSidebarSection(
  layout: SidebarLayout,
  sectionId: SidebarSectionId,
  title: string,
): SidebarLayout {
  return updateSection(layout, sectionId, (section) => ({ ...section, title }));
}

export function setSidebarSectionCollapsed(
  layout: SidebarLayout,
  sectionId: SidebarSectionId,
  collapsed: boolean,
): SidebarLayout {
  return updateSection(layout, sectionId, (section) => ({ ...section, collapsed }));
}

/** Its bots and rooms go back to the default lists. */
export function removeSidebarSection(
  layout: SidebarLayout,
  sectionId: SidebarSectionId,
): SidebarLayout {
  return { sections: layout.sections.filter((section) => section.id !== sectionId) };
}

export function moveSidebarSection(
  layout: SidebarLayout,
  sectionId: SidebarSectionId,
  toIndex: number,
): SidebarLayout {
  const section = layout.sections.find((candidate) => candidate.id === sectionId);
  if (section === undefined) return layout;
  const rest = layout.sections.filter((candidate) => candidate.id !== sectionId);
  const index = Math.max(0, Math.min(toIndex, rest.length));
  return { sections: [...rest.slice(0, index), section, ...rest.slice(index)] };
}

/**
 * Puts a bot or room into a section before `beforeKey`, or at its end, taking it out of any
 * other. A null section sends it back to the default lists.
 */
export function placeSidebarItem(
  layout: SidebarLayout,
  key: string,
  target: { readonly sectionId: SidebarSectionId; readonly beforeKey: string | null } | null,
): SidebarLayout {
  const sections = withoutItem(layout.sections, key);
  if (target === null) return { sections };
  return {
    sections: sections.map((section) => {
      if (section.id !== target.sectionId) return section;
      const index = target.beforeKey === null ? -1 : section.items.indexOf(target.beforeKey);
      const items =
        index === -1
          ? [...section.items, key]
          : [...section.items.slice(0, index), key, ...section.items.slice(index)];
      return { ...section, items };
    }),
  };
}

export interface SidebarLayoutHome {
  readonly environmentId: EnvironmentId;
  /** Null until it loads, or on a server too old to keep one. */
  readonly layout: SidebarLayout | null;
}

/**
 * Which environment keeps the viewer's sections, so every client picks the same one: the first
 * by id that already has some, else the first that answered. Linking another machine later does
 * not move them.
 */
export function chooseSidebarLayoutHome(
  candidates: ReadonlyArray<SidebarLayoutHome>,
): SidebarLayoutHome | null {
  const sorted = [...candidates].sort((a, b) => a.environmentId.localeCompare(b.environmentId));
  return (
    sorted.find((candidate) => (candidate.layout?.sections.length ?? 0) > 0) ??
    sorted.find((candidate) => candidate.layout !== null) ??
    null
  );
}

/** The viewer's sidebar sections, kept on one of their environments. */
export function createSidebarLayoutEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const layout = createEnvironmentRpcSubscriptionAtomFamily(runtime, {
    label: "environment-data:sidebar-layout",
    tag: WS_METHODS.sidebarLayoutSubscribe,
  });
  return {
    layout,
    /** The chosen home across environments, keyed by their ids joined with newlines. */
    home: Atom.family((environmentIds: string) =>
      Atom.make((get) =>
        chooseSidebarLayoutHome(
          environmentIds
            .split("\n")
            .filter((id) => id.length > 0)
            .map((id) => {
              const environmentId = id as EnvironmentId;
              const result = get(layout({ environmentId, input: {} }));
              return { environmentId, layout: AsyncResult.getOrElse(result, () => null) };
            }),
        ),
      ),
    ),
    /** A change shown before its home echoes it, while the home still shows `base`. */
    pending: Atom.make<{
      readonly layout: SidebarLayout;
      readonly base: SidebarLayout | null;
    } | null>(null).pipe(Atom.keepAlive, Atom.withLabel("sidebar-layout:pending")),
    set: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:sidebar-layout:set",
      tag: WS_METHODS.sidebarLayoutSet,
    }),
  };
}
