import { useNavigation } from "@react-navigation/native";
import { use, useState } from "react";
import { Platform, useWindowDimensions } from "react-native";

import { AppBar } from "../../components/ui/AppBar";
import { Toolbar } from "../../components/ui/Toolbar";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useDeviceType, useNativeColumnLayoutMetrics } from "../../native/native-layout-metrics";
import { NativePrimaryColumnContext } from "../../native/v5-workspace-context";
import { useProjects } from "../../state/entities";
import { useWorkspaceState } from "../../state/workspace";
import { BotListScreen } from "../bots/BotListScreen";
import { BotListToolbar } from "../bots/BotListToolbar";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import { WorkspaceEmptyDetail } from "../layout/WorkspaceEmptyDetail";
import { openSettings } from "../settings/settings-navigation";
import { useWorkspaceTabs } from "../workspace/WorkspaceTabsContext";
import { AndroidHomeFabLayout } from "./AndroidHomeFab";
import { useHomeRouteVisible } from "./home-route-visibility";
import { getConnectionAwareBrandHeaderOptions } from "./WorkspaceConnectionTitle";

export function HomeRouteScreen() {
  const { width: windowWidth } = useWindowDimensions();
  const nativePrimaryColumn = use(NativePrimaryColumnContext);
  const columnMetrics = useNativeColumnLayoutMetrics();
  const deviceType = useDeviceType();
  const headerWidth = nativePrimaryColumn ? (columnMetrics?.width ?? windowWidth) : windowWidth;
  const { layout, panes, primarySidebarSearchQuery, setPrimarySidebarSearchQuery, addBot } =
    useAdaptiveWorkspaceLayout();
  const projects = useProjects();
  // Stop re-deriving the bot list while Thread covers Home.
  const visible = useHomeRouteVisible();
  const { state: catalogState } = useWorkspaceState();
  const navigation = useNavigation();
  const workspace = useWorkspaceTabs();
  const [localSearchQuery, setLocalSearchQuery] = useState("");
  const searchQuery =
    Platform.OS === "android"
      ? primarySidebarSearchQuery
      : (workspace?.state.tabs.threads.query ?? localSearchQuery);
  const setSearchQuery = (query: string) => {
    if (Platform.OS === "android") setPrimarySidebarSearchQuery(query);
    else if (workspace) workspace.dispatch({ type: "query", query, tab: "threads" });
    else setLocalSearchQuery(query);
  };
  const openEnvironments = () => openSettings(navigation, "SettingsEnvironments");

  if (layout.usesSplitView && !nativePrimaryColumn) {
    return (
      <>
        <NativeStackScreenOptions
          options={
            Platform.OS === "android"
              ? { headerShown: false }
              : {
                  title: "",
                  headerTitle: "",
                  unstable_headerLeftItems: () => [],
                  headerSearchBarOptions: undefined,
                  unstable_headerRightItems: () => [],
                  unstable_headerToolbarItems: () => [],
                }
          }
        />
        {Platform.OS === "ios" && addBot ? (
          <Toolbar placement="left">
            <Toolbar.Button accessibilityLabel="Add bot" icon="plus" onPress={addBot} />
          </Toolbar>
        ) : null}
        {Platform.OS === "android" ? <AppBar embedded title="Bots" /> : null}
        <WorkspaceEmptyDetail
          onAddConnection={
            Platform.OS === "android" && !catalogState.hasConnections
              ? () => openSettings(navigation, "SettingsEnvironmentNew")
              : undefined
          }
          onAddBot={Platform.OS === "android" && panes.primarySidebarVisible ? undefined : addBot}
        />
      </>
    );
  }

  return (
    <AndroidHomeFabLayout
      disabled={workspace !== null && Platform.OS !== "android"}
      onAddBot={addBot}
    >
      <>
        {/* Screen options merge shallowly; restore the header after split view. */}
        {workspace !== null && Platform.OS === "ios" ? null : (
          <NativeStackScreenOptions
            optionsVersion={headerWidth}
            options={{
              ...getConnectionAwareBrandHeaderOptions({
                headerWidth,
                trailingItemCount: nativePrimaryColumn && deviceType === "pad" ? 2 : 1,
                onOpenEnvironments: openEnvironments,
              }),
              headerShown: Platform.OS !== "android",
            }}
          />
        )}
        {Platform.OS === "android" ? (
          <>
            <NativeStackScreenOptions options={{ headerShown: false }} />
            <BotListToolbar
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
              onOpenEnvironments={openEnvironments}
            />
          </>
        ) : null}
        <BotListScreen
          visible={visible}
          searchQuery={searchQuery}
          catalogState={catalogState}
          projectCount={projects.length}
          onAddConnection={() => openSettings(navigation, "SettingsEnvironmentNew")}
          onAddBot={addBot}
        />
      </>
    </AndroidHomeFabLayout>
  );
}
