import {
  type DraggableSyntheticListeners,
  useDndContext,
  useDraggable,
  useDroppable,
} from "@dnd-kit/core";
import type { SidebarSectionId } from "@t3tools/contracts";
import { createContext, use, type DragEvent } from "react";

import { cn } from "~/lib/utils";

/** What a sidebar drag carries: a bot or room by its sidebar key, or a whole section. */
export type SidebarDragData =
  | { readonly kind: "item"; readonly key: string; readonly label: string }
  | { readonly kind: "section"; readonly sectionId: SidebarSectionId; readonly label: string };

/** Where it lands: a row (its section, or none for the default lists), a header, or a list. */
export type SidebarDropData =
  | { readonly kind: "item"; readonly key: string; readonly sectionId: SidebarSectionId | null }
  | { readonly kind: "section"; readonly sectionId: SidebarSectionId }
  | { readonly kind: "unsorted" };

/** The edge of the row under the pointer, so the line shows where the drop puts it. */
export interface SidebarDropHint {
  readonly id: string;
  readonly edge: "before" | "after";
}

export const SidebarDropHintContext = createContext<SidebarDropHint | null>(null);

export interface SidebarEntryDnd {
  readonly setNodeRef: (node: HTMLElement | null) => void;
  readonly listeners: DraggableSyntheticListeners & {
    readonly onDragStart: (event: DragEvent) => void;
  };
  readonly isDragging: boolean;
  readonly dropEdge: "before" | "after" | null;
}

// A link's native drag would take the pointer away from the sidebar drag.
const preventNativeDrag = (event: DragEvent) => event.preventDefault();

function useDropEdge(id: string, isOver: boolean) {
  const hint = use(SidebarDropHintContext);
  return isOver && hint?.id === id ? hint.edge : null;
}

/** Drag and drop for a bot or room row. */
export function useSidebarEntryDnd(
  drag: Extract<SidebarDragData, { kind: "item" }>,
  sectionId: SidebarSectionId | null,
): SidebarEntryDnd {
  const id = `item:${drag.key}`;
  const draggable = useDraggable({ id, data: drag });
  const droppable = useDroppable({
    id,
    data: { kind: "item", key: drag.key, sectionId } satisfies SidebarDropData,
  });
  const dropEdge = useDropEdge(id, droppable.isOver && draggable.active?.id !== id);
  return {
    setNodeRef: (node) => {
      draggable.setNodeRef(node);
      droppable.setNodeRef(node);
    },
    listeners: { ...draggable.listeners, onDragStart: preventNativeDrag },
    isDragging: draggable.isDragging,
    dropEdge,
  };
}

/** Drag and drop for a section header: drag to reorder, drop a row to put it first. */
export function useSidebarSectionDnd(
  drag: Extract<SidebarDragData, { kind: "section" }>,
): SidebarEntryDnd {
  const id = `section:${drag.sectionId}`;
  const draggable = useDraggable({ id, data: drag });
  const droppable = useDroppable({
    id,
    data: { kind: "section", sectionId: drag.sectionId } satisfies SidebarDropData,
  });
  const dropEdge = useDropEdge(id, droppable.isOver && draggable.active?.id !== id);
  return {
    setNodeRef: (node) => {
      draggable.setNodeRef(node);
      droppable.setNodeRef(node);
    },
    listeners: { ...draggable.listeners, onDragStart: preventNativeDrag },
    isDragging: draggable.isDragging,
    dropEdge,
  };
}

/** A default list's header: dropping a row here takes it out of its section. */
export function useSidebarUnsortedDrop(id: string) {
  const { active } = useDndContext();
  const droppable = useDroppable({ id, data: { kind: "unsorted" } satisfies SidebarDropData });
  const isItem = (active?.data.current as SidebarDragData | undefined)?.kind === "item";
  return { setNodeRef: droppable.setNodeRef, isOver: droppable.isOver && isItem };
}

export function sidebarEntryDndClassName(
  dnd: Pick<SidebarEntryDnd, "isDragging" | "dropEdge"> | undefined,
) {
  if (dnd === undefined) return undefined;
  return cn(
    "relative",
    dnd.isDragging && "opacity-40",
    dnd.dropEdge !== null &&
      "after:pointer-events-none after:absolute after:inset-x-2 after:h-0.5 after:rounded-full after:bg-primary",
    dnd.dropEdge === "before" && "after:-top-px",
    dnd.dropEdge === "after" && "after:-bottom-px",
  );
}
