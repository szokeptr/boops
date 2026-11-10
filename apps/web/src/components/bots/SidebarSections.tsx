import {
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  DragOverlay,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { BotRow } from "@t3tools/client-runtime/state/bot-list";
import {
  moveSidebarSection,
  type OrganizedSidebarSection,
  placeSidebarItem,
  removeSidebarSection,
  renameSidebarSection,
  setSidebarSectionCollapsed,
  sidebarSectionTitle,
} from "@t3tools/client-runtime/state/sidebar-sections";
import type {
  ContextMenuItem,
  EnvironmentId,
  RoomSummary,
  SidebarLayout,
  SidebarSectionId,
} from "@t3tools/contracts";
import { PlusIcon } from "lucide-react";
import { use, useRef, useState, type MouseEvent, type ReactNode } from "react";

import { readLocalApi } from "../../localApi";
import { Button } from "../ui/button";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { Input } from "../ui/input";
import {
  type SidebarDragData,
  type SidebarDropData,
  type SidebarDropHint,
  SidebarDropHintContext,
  sidebarEntryDndClassName,
  useSidebarSectionDnd,
  useSidebarUnsortedDrop,
} from "./sidebarDnd";
import {
  createSidebarSection,
  NEW_SECTION_TITLE,
  SidebarSectionsContext,
} from "./sidebarSectionsContext";

export type SidebarEntry =
  | { readonly kind: "bot"; readonly sidebarKey: string; readonly row: BotRow }
  | {
      readonly kind: "room";
      readonly sidebarKey: string;
      readonly environmentId: EnvironmentId;
      readonly room: RoomSummary;
    };

type Sections = ReadonlyArray<OrganizedSidebarSection<SidebarEntry>>;

// Rows, not gaps: a drop between rows lands on neither and is cancelled.
const collisionDetection: CollisionDetection = (args) => pointerWithin(args);

function dropEdge(event: DragMoveEvent | DragEndEvent): "before" | "after" {
  const dragged = event.active.rect.current.translated;
  const over = event.over?.rect;
  if (!dragged || !over) return "after";
  return dragged.top + dragged.height / 2 < over.top + over.height / 2 ? "before" : "after";
}

// A drag ends with a click on the row it started on; swallow clicks until the drop settles.
const swallowClick = (event: Event) => {
  event.preventDefault();
  event.stopPropagation();
};
const startSwallowingClicks = () => window.addEventListener("click", swallowClick, true);
const stopSwallowingClicks = () =>
  setTimeout(() => window.removeEventListener("click", swallowClick, true), 0);

/** Where a drop puts the dragged row or section; null when it changes nothing. */
function applyDrop(
  layout: SidebarLayout,
  sections: Sections,
  drag: SidebarDragData,
  drop: SidebarDropData,
  edge: "before" | "after",
): SidebarLayout | null {
  if (drag.kind === "item") {
    if (drop.kind === "unsorted") return placeSidebarItem(layout, drag.key, null);
    if (drop.kind === "section") {
      const first = sections
        .find((entry) => entry.section.id === drop.sectionId)
        ?.items.find((item) => item.sidebarKey !== drag.key);
      return placeSidebarItem(layout, drag.key, {
        sectionId: drop.sectionId,
        beforeKey: first?.sidebarKey ?? null,
      });
    }
    if (drop.key === drag.key) return null;
    if (drop.sectionId === null) return placeSidebarItem(layout, drag.key, null);
    const visible = (sections.find((entry) => entry.section.id === drop.sectionId)?.items ?? [])
      .map((item) => item.sidebarKey)
      .filter((key) => key !== drag.key);
    const index = visible.indexOf(drop.key);
    const beforeKey = edge === "before" ? drop.key : (visible[index + 1] ?? null);
    return placeSidebarItem(layout, drag.key, { sectionId: drop.sectionId, beforeKey });
  }
  const targetId =
    drop.kind === "section" ? drop.sectionId : drop.kind === "item" ? drop.sectionId : null;
  if (targetId === drag.sectionId) return null;
  const rest = layout.sections.filter((section) => section.id !== drag.sectionId);
  if (targetId === null) return moveSidebarSection(layout, drag.sectionId, rest.length);
  const index = rest.findIndex((section) => section.id === targetId);
  const after = drop.kind === "item" || edge === "after";
  return moveSidebarSection(layout, drag.sectionId, index + (after ? 1 : 0));
}

/** Drag and drop across the sidebar: rows between sections, and sections among themselves. */
export function SidebarDnd(props: { readonly sections: Sections; readonly children: ReactNode }) {
  const api = use(SidebarSectionsContext);
  const [dragLabel, setDragLabel] = useState<string | null>(null);
  const [hint, setHint] = useState<SidebarDropHint | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Long-press on touch, so a swipe still scrolls the list.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );
  const onDragMove = (event: DragMoveEvent) => {
    const drag = event.active.data.current as SidebarDragData | undefined;
    const drop = event.over?.data.current as SidebarDropData | undefined;
    // An item dropped on a header goes first, so the line sits under the header.
    const edge = drag?.kind === "item" && drop?.kind === "section" ? "after" : dropEdge(event);
    const next = event.over ? { id: String(event.over.id), edge } : null;
    if (next?.id !== hint?.id || next?.edge !== hint?.edge) setHint(next);
  };
  const onDragEnd = (event: DragEndEvent) => {
    setHint(null);
    setDragLabel(null);
    stopSwallowingClicks();
    const drag = event.active.data.current as SidebarDragData | undefined;
    const drop = event.over?.data.current as SidebarDropData | undefined;
    if (!api || !drag || !drop) return;
    const next = applyDrop(api.layout, props.sections, drag, drop, dropEdge(event));
    if (next !== null) api.update(() => next);
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={(event) => {
        startSwallowingClicks();
        setDragLabel((event.active.data.current as SidebarDragData | undefined)?.label ?? null);
      }}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        stopSwallowingClicks();
        setHint(null);
        setDragLabel(null);
      }}
    >
      <SidebarDropHintContext value={hint}>{props.children}</SidebarDropHintContext>
      <DragOverlay dropAnimation={null}>
        {dragLabel === null ? null : (
          <div className="w-fit max-w-56 truncate rounded-lg bg-popover px-3 py-1.5 text-sm font-medium text-popover-foreground shadow-lg ring-1 ring-border">
            {dragLabel}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function sectionContextMenu(index: number, count: number): ContextMenuItem[] {
  return [
    { id: "rename", label: "Rename" },
    { id: "up", label: "Move up", disabled: index === 0, separatorBefore: true },
    { id: "down", label: "Move down", disabled: index === count - 1 },
    { id: "delete", label: "Delete section", destructive: true, separatorBefore: true },
  ];
}

/** One of the viewer's sections: a collapsible header, then its bots and rooms in order. */
export function SidebarSectionBlock(props: {
  readonly entry: OrganizedSidebarSection<SidebarEntry>;
  readonly index: number;
  readonly renderItem: (item: SidebarEntry, sectionId: SidebarSectionId) => ReactNode;
}) {
  const api = use(SidebarSectionsContext);
  const { section, items } = props.entry;
  const { setNodeRef, listeners, isDragging, dropEdge } = useSidebarSectionDnd({
    kind: "section",
    sectionId: section.id,
    label: section.title,
  });
  if (api === null) return null;
  const count = api.layout.sections.length;
  const editing = api.editingSectionId === section.id;
  const attention = items.some((item) =>
    item.kind === "bot"
      ? item.row.unread || item.row.status === "needs-you"
      : item.room.needsYou || (item.room.unread && !item.room.muted),
  );
  const showMenu = async (event: MouseEvent) => {
    const local = readLocalApi();
    if (!local) return;
    event.preventDefault();
    const action = await local.contextMenu.show(sectionContextMenu(props.index, count), {
      x: event.clientX,
      y: event.clientY,
    });
    if (action === "rename") api.setEditingSectionId(section.id);
    if (action === "up")
      api.update((layout) => moveSidebarSection(layout, section.id, props.index - 1));
    if (action === "down") {
      api.update((layout) => moveSidebarSection(layout, section.id, props.index + 1));
    }
    if (action === "delete") api.update((layout) => removeSidebarSection(layout, section.id));
  };
  return (
    <section aria-label={section.title} className="mt-2 flex flex-col gap-px">
      <div
        ref={setNodeRef}
        {...(editing ? {} : listeners)}
        className={sidebarEntryDndClassName({ isDragging, dropEdge })}
      >
        {editing ? (
          <SectionTitleInput
            initial={section.title}
            onDone={(title) => {
              api.setEditingSectionId(null);
              if (title !== null && title !== section.title) {
                api.update((layout) => renameSidebarSection(layout, section.id, title));
              }
            }}
          />
        ) : (
          <CollapsibleSectionHeader
            expanded={!section.collapsed}
            onClick={() =>
              api.update((layout) =>
                setSidebarSectionCollapsed(layout, section.id, !section.collapsed),
              )
            }
            onContextMenu={(event) => void showMenu(event)}
            accessory={
              section.collapsed ? (
                <span className="flex shrink-0 items-center gap-1.5 tabular-nums">
                  {attention ? (
                    <span aria-label="Unread" className="size-1.5 rounded-full bg-primary" />
                  ) : null}
                  {items.length}
                </span>
              ) : null
            }
          >
            {section.title}
          </CollapsibleSectionHeader>
        )}
      </div>
      {section.collapsed ? null : items.length === 0 ? (
        <p className="px-2 pb-1 text-xs text-sidebar-muted-foreground">
          Drag bots or group chats here.
        </p>
      ) : (
        <ul className="flex flex-col gap-px">
          {items.map((item) => props.renderItem(item, section.id))}
        </ul>
      )}
    </section>
  );
}

function SectionTitleInput(props: {
  readonly initial: string;
  readonly onDone: (title: string | null) => void;
}) {
  const [value, setValue] = useState(props.initial === NEW_SECTION_TITLE ? "" : props.initial);
  const done = useRef(false);
  const finish = (title: string | null) => {
    if (done.current) return;
    done.current = true;
    props.onDone(title);
  };
  return (
    <Input
      size="sm"
      autoFocus
      aria-label="Section name"
      placeholder={NEW_SECTION_TITLE}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => finish(sidebarSectionTitle(value))}
      onKeyDown={(event) => {
        if (event.key === "Enter") finish(sidebarSectionTitle(value));
        if (event.key === "Escape") finish(null);
      }}
    />
  );
}

/** The header over bots in no section; dropping a row on it takes the row out of its section. */
export function UnsortedHeader(props: { readonly label: string }) {
  const { setNodeRef, isOver } = useSidebarUnsortedDrop("unsorted:bots");
  return (
    <div
      ref={setNodeRef}
      className={
        isOver ? "mt-3 rounded-md bg-sidebar-row-hover px-2 pb-1" : "mt-3 rounded-md px-2 pb-1"
      }
    >
      <h2 className="font-medium text-sidebar-muted-foreground text-xs">{props.label}</h2>
    </div>
  );
}

export function NewSectionButton() {
  const api = use(SidebarSectionsContext);
  if (api === null) return null;
  return (
    <div className="mt-3 self-start">
      <Button size="xs" variant="ghost-muted" onClick={() => createSidebarSection(api)}>
        <PlusIcon />
        New section
      </Button>
    </div>
  );
}
