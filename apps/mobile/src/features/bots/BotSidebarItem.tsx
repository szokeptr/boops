import type { BotRow } from "@t3tools/client-runtime/state/bot-list";
import type { ReactNode } from "react";

import { SidebarRoomRow } from "../rooms/RoomListSection";
import { type BotSidebarItem, BotsHeaderRow, SidebarSectionHeaderRow } from "./sidebarSections";

/** Renders one bot list row; bots go through `renderBot` so each list keeps its own row props. */
export function renderBotSidebarItem(
  item: BotSidebarItem,
  renderBot: (row: BotRow) => ReactNode,
): ReactNode {
  switch (item.type) {
    case "section":
      return <SidebarSectionHeaderRow item={item} />;
    case "bots-header":
      return <BotsHeaderRow />;
    case "room":
      return <SidebarRoomRow environmentId={item.environmentId} room={item.room} />;
    case "bot":
      return renderBot(item.row);
  }
}
