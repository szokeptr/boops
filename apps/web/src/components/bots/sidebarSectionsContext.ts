import {
  addSidebarSection,
  placeSidebarItem,
} from "@t3tools/client-runtime/state/sidebar-sections";
import { type ContextMenuItem, type SidebarLayout, SidebarSectionId } from "@t3tools/contracts";
import { createContext, use } from "react";

import { randomUUID } from "~/lib/utils";

export interface SidebarSectionsApi {
  readonly layout: SidebarLayout;
  readonly update: (change: (layout: SidebarLayout) => SidebarLayout) => void;
  readonly editingSectionId: SidebarSectionId | null;
  readonly setEditingSectionId: (sectionId: SidebarSectionId | null) => void;
}

export const SidebarSectionsContext = createContext<SidebarSectionsApi | null>(null);

const MOVE_NEW = "move-section:new";
const MOVE_NONE = "move-section:none";
const MOVE_PREFIX = "move-section:to:";

export const NEW_SECTION_TITLE = "New section";

/** A new section, named inline right away; `items` move into it. */
export function createSidebarSection(api: SidebarSectionsApi, items: ReadonlyArray<string> = []) {
  const id = SidebarSectionId.make(randomUUID());
  api.update((layout) => addSidebarSection(layout, { id, title: NEW_SECTION_TITLE }, items));
  api.setEditingSectionId(id);
}

/** "Move to section ▸" for a bot's or room's right-click menu; empty outside the sidebar. */
export function useMoveToSectionMenu(key: string) {
  return moveToSectionMenu(use(SidebarSectionsContext), key);
}

export function moveToSectionMenu(api: SidebarSectionsApi | null, key: string) {
  if (api === null) {
    return { items: [] as ContextMenuItem[], handle: (_action: string | null) => false };
  }
  const current = api.layout.sections.find((section) => section.items.includes(key)) ?? null;
  const children: ContextMenuItem[] = [
    ...api.layout.sections.map((section) => ({
      id: `${MOVE_PREFIX}${section.id}`,
      label: section.title,
      checked: section.id === current?.id,
    })),
    { id: MOVE_NEW, label: "New section…", separatorBefore: api.layout.sections.length > 0 },
  ];
  if (current !== null) children.push({ id: MOVE_NONE, label: `Remove from ${current.title}` });
  const items: ContextMenuItem[] = [
    { id: "move-section", label: "Move to section", separatorBefore: true, children },
  ];
  const handle = (action: string | null) => {
    if (action === MOVE_NEW) createSidebarSection(api, [key]);
    else if (action === MOVE_NONE) api.update((layout) => placeSidebarItem(layout, key, null));
    else if (action?.startsWith(MOVE_PREFIX)) {
      const sectionId = SidebarSectionId.make(action.slice(MOVE_PREFIX.length));
      api.update((layout) => placeSidebarItem(layout, key, { sectionId, beforeKey: null }));
    } else return false;
    return true;
  };
  return { items, handle };
}
