import { useNavigation } from "@react-navigation/native";

import { BotNavigationSidebar } from "../bots/BotNavigationSidebar";
import { useAdaptiveWorkspaceLayout } from "../layout/adaptive-workspace-context";
import { openSettings } from "../settings/settings-navigation";

/** The bot list in the workspace's sidebar column. */
export function WorkspaceBotSidebar() {
  const navigation = useNavigation();
  const {
    layout,
    panes,
    primarySidebarSearchQuery,
    setPrimarySidebarSearchQuery,
    revealPrimarySidebar,
    openWorkspaceTab,
    addBot,
  } = useAdaptiveWorkspaceLayout();
  return (
    <BotNavigationSidebar
      width={layout.listPaneWidth ?? 0}
      visible={panes.primarySidebarVisible}
      onRequestVisibility={revealPrimarySidebar}
      onOpenSettings={() => openWorkspaceTab("settings")}
      onOpenEnvironmentSettings={() => openSettings(navigation, "SettingsEnvironments")}
      onAddBot={addBot}
      onSearchQueryChange={setPrimarySidebarSearchQuery}
      searchQuery={primarySidebarSearchQuery}
    />
  );
}
