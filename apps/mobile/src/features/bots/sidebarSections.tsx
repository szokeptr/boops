import type { BotRow } from "@t3tools/client-runtime/state/bot-list";
import {
  addSidebarSection,
  moveSidebarSection,
  organizeSidebar,
  placeSidebarItem,
  removeSidebarSection,
  renameSidebarSection,
  setSidebarSectionCollapsed,
  sidebarBotKey,
  sidebarRoomKey,
  sidebarSectionTitle,
} from "@t3tools/client-runtime/state/sidebar-sections";
import {
  type EnvironmentId,
  type RoomSummary,
  type SidebarLayout,
  type SidebarSection,
  SidebarSectionId,
} from "@t3tools/contracts";
import type { MenuAction } from "@react-native-menu/menu";
import { createContext, use } from "react";
import { Platform, Pressable, View } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { Menu } from "../../components/ui/Menu";
import { uuidv4 } from "../../lib/uuid";
import { useEnvironments } from "../../state/environments";
import { useOpenRooms } from "../../state/rooms";
import { useSidebarLayout } from "../../state/sidebarLayout";

export interface SidebarSectionsApi {
  readonly layout: SidebarLayout;
  readonly update: (change: (layout: SidebarLayout) => SidebarLayout) => void;
}

export const SidebarSectionsContext = createContext<SidebarSectionsApi | null>(null);

/** One row of the bot list: a section header, a bot, a room in a section, or the "Bots" header. */
export type BotSidebarItem =
  | {
      readonly type: "section";
      readonly key: string;
      readonly section: SidebarSection;
      readonly index: number;
      readonly itemCount: number;
      readonly attention: boolean;
    }
  | { readonly type: "bot"; readonly key: string; readonly row: BotRow }
  | {
      readonly type: "room";
      readonly key: string;
      readonly environmentId: EnvironmentId;
      readonly room: RoomSummary;
    }
  | { readonly type: "bots-header"; readonly key: string };

type Entry =
  | { readonly kind: "bot"; readonly sidebarKey: string; readonly row: BotRow }
  | {
      readonly kind: "room";
      readonly sidebarKey: string;
      readonly environmentId: EnvironmentId;
      readonly room: RoomSummary;
    };

const roomActivity = (room: RoomSummary) => room.lastMessage?.createdAt ?? room.createdAt;
const NO_KEYS: ReadonlySet<string> = new Set();

/**
 * The bot list as rows: the viewer's sections with their bots and rooms, then the bots in none.
 * A search lists matching bots alone, as before sections.
 */
export function useBotSidebarItems(input: {
  readonly rows: ReadonlyArray<BotRow>;
  readonly listed: ReadonlyArray<BotRow>;
  readonly searchQuery: string;
}) {
  const { environments } = useEnvironments();
  const rooms = useOpenRooms(environments.map((environment) => environment.environmentId));
  const { layout, update } = useSidebarLayout();
  const api: SidebarSectionsApi = { layout, update };
  const bot = (row: BotRow): BotSidebarItem => ({ type: "bot", key: `bot:${row.key}`, row });
  if (input.searchQuery.trim().length > 0 || layout.sections.length === 0) {
    return { api, items: input.listed.map(bot), placedKeys: NO_KEYS };
  }
  const organized = organizeSidebar<Entry>(layout, [
    ...input.rows.map((row) => ({
      kind: "bot" as const,
      sidebarKey: sidebarBotKey(row.environmentId, row.projectId),
      row,
    })),
    ...[...rooms]
      .sort((a, b) => roomActivity(b.room).localeCompare(roomActivity(a.room)))
      .map(({ environmentId, room }) => ({
        kind: "room" as const,
        sidebarKey: sidebarRoomKey(environmentId, room.id),
        environmentId,
        room,
      })),
  ]);
  const placedKeys = new Set(
    organized.sections.flatMap((entry) => entry.items.map((item) => item.sidebarKey)),
  );
  const unsorted = input.listed.filter(
    (row) => !placedKeys.has(sidebarBotKey(row.environmentId, row.projectId)),
  );
  const items: BotSidebarItem[] = [];
  organized.sections.forEach(({ section, items: entries }, index) => {
    items.push({
      type: "section",
      key: `section:${section.id}`,
      section,
      index,
      itemCount: entries.length,
      attention: entries.some((entry) =>
        entry.kind === "bot"
          ? entry.row.unread || entry.row.status === "needs-you"
          : entry.room.needsYou || (entry.room.unread && !entry.room.muted),
      ),
    });
    if (section.collapsed) return;
    for (const entry of entries) {
      items.push(
        entry.kind === "bot"
          ? { type: "bot", key: `${section.id}:${entry.sidebarKey}`, row: entry.row }
          : {
              type: "room",
              key: `${section.id}:${entry.sidebarKey}`,
              environmentId: entry.environmentId,
              room: entry.room,
            },
      );
    }
  });
  if (unsorted.length > 0) items.push({ type: "bots-header", key: "bots-header" });
  items.push(...unsorted.map(bot));
  return { api, items, placedKeys };
}

function promptSectionName(title: string, initialValue: string, onName: (name: string) => void) {
  Dialog.prompt({
    title,
    placeholder: "Section name",
    initialValue,
    confirmText: "Save",
    onConfirm: (value) => {
      const name = sidebarSectionTitle(value);
      if (name !== null) onName(name);
    },
  });
}

/** Asks for a name, then adds a section holding `items`. */
export function createSidebarSection(api: SidebarSectionsApi, items: ReadonlyArray<string> = []) {
  promptSectionName("New section", "", (title) =>
    api.update((layout) =>
      addSidebarSection(layout, { id: SidebarSectionId.make(uuidv4()), title }, items),
    ),
  );
}

const MOVE_NEW = "move-section:new";
const MOVE_NONE = "move-section:none";
const MOVE_PREFIX = "move-section:to:";

/** "Move to section" for a bot's or room's long-press menu; nothing outside the bot list. */
export function useMoveToSectionAction(key: string) {
  const api = use(SidebarSectionsContext);
  if (api === null) return { actions: [] as MenuAction[], handle: (_event: string) => false };
  const current = api.layout.sections.find((section) => section.items.includes(key)) ?? null;
  const subactions: MenuAction[] = [
    ...api.layout.sections.map((section): MenuAction => ({
      id: `${MOVE_PREFIX}${section.id}`,
      title: section.title,
      state: section.id === current?.id ? "on" : "off",
    })),
    {
      id: MOVE_NEW,
      title: "New section…",
      image: Platform.OS === "ios" ? "plus" : "add",
    },
    ...(current === null
      ? []
      : [
          {
            id: MOVE_NONE,
            title: `Remove from ${current.title}`,
            attributes: { destructive: true },
          },
        ]),
  ];
  const actions: MenuAction[] = [
    {
      id: "move-section",
      title: "Move to section",
      image: Platform.OS === "ios" ? "folder" : "folder",
      subactions,
    },
  ];
  const handle = (event: string) => {
    if (event === MOVE_NEW) createSidebarSection(api, [key]);
    else if (event === MOVE_NONE) api.update((layout) => placeSidebarItem(layout, key, null));
    else if (event.startsWith(MOVE_PREFIX)) {
      const sectionId = SidebarSectionId.make(event.slice(MOVE_PREFIX.length));
      api.update((layout) => placeSidebarItem(layout, key, { sectionId, beforeKey: null }));
    } else return false;
    return true;
  };
  return { actions, handle };
}

/** A section's header: tap to fold it, long-press to rename, reorder or delete it. */
export function SidebarSectionHeaderRow(props: {
  readonly item: Extract<BotSidebarItem, { type: "section" }>;
}) {
  const api = use(SidebarSectionsContext);
  const { section, index } = props.item;
  if (api === null) return null;
  const count = api.layout.sections.length;
  const actions: MenuAction[] = [
    { id: "rename", title: "Rename", image: Platform.OS === "ios" ? "pencil" : "edit" },
    ...(index > 0
      ? [{ id: "up", title: "Move up", image: Platform.OS === "ios" ? "arrow.up" : "arrow_upward" }]
      : []),
    ...(index < count - 1
      ? [
          {
            id: "down",
            title: "Move down",
            image: Platform.OS === "ios" ? "arrow.down" : "arrow_downward",
          },
        ]
      : []),
    {
      id: "delete",
      title: "Delete section",
      image: Platform.OS === "ios" ? "trash" : "delete",
      attributes: { destructive: true },
    },
  ];
  return (
    <Menu
      actions={actions}
      shouldOpenOnLongPress
      onPressAction={({ nativeEvent }) => {
        const event = nativeEvent.event;
        if (event === "rename") {
          promptSectionName("Rename section", section.title, (title) =>
            api.update((layout) => renameSidebarSection(layout, section.id, title)),
          );
        }
        if (event === "up")
          api.update((layout) => moveSidebarSection(layout, section.id, index - 1));
        if (event === "down") {
          api.update((layout) => moveSidebarSection(layout, section.id, index + 1));
        }
        if (event === "delete") api.update((layout) => removeSidebarSection(layout, section.id));
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={section.title}
        accessibilityState={{ expanded: !section.collapsed }}
        className="mt-3 min-h-9 flex-row items-center gap-2 rounded-xl pr-2 pl-2 active:opacity-70"
        onPress={() =>
          api.update((layout) => setSidebarSectionCollapsed(layout, section.id, !section.collapsed))
        }
      >
        <Text
          numberOfLines={1}
          className="min-w-0 flex-1 font-t3-bold text-sm text-foreground-muted"
        >
          {section.title}
        </Text>
        {section.collapsed ? (
          <View className="flex-row items-center gap-1.5">
            {props.item.attention ? <View className="size-2 rounded-full bg-primary" /> : null}
            <Text className="text-sm tabular-nums text-foreground-muted">
              {props.item.itemCount}
            </Text>
          </View>
        ) : null}
        <SymbolView
          name={section.collapsed ? "chevron.right" : "chevron.down"}
          size={12}
          tintColorClassName="accent-foreground-muted"
        />
      </Pressable>
    </Menu>
  );
}

/** Over the bots in no section, once there are sections. */
export function BotsHeaderRow() {
  return (
    <View className="mt-4 min-h-9 justify-center pl-2">
      <Text className="font-t3-bold text-sm text-foreground-muted">Bots</Text>
    </View>
  );
}

/** At the end of the list: start a section. */
export function NewSectionRow(props: { readonly searchQuery: string }) {
  const api = use(SidebarSectionsContext);
  if (api === null || props.searchQuery.trim().length > 0) return null;
  return (
    <Pressable
      accessibilityRole="button"
      className="mt-3 min-h-11 flex-row items-center gap-2 self-start rounded-xl px-2 active:opacity-70"
      onPress={() => createSidebarSection(api)}
    >
      <SymbolView name="plus" size={14} tintColorClassName="accent-foreground-muted" />
      <Text className="text-sm text-foreground-muted">New section</Text>
    </Pressable>
  );
}
