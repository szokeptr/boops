import { useAtomValue } from "@effect/atom-react";
import { splitPinnedBots, type BotRow } from "@t3tools/client-runtime/state/bot-list";
import type { LegendListRef } from "@legendapp/list/react-native";
import { LegendList } from "@legendapp/list/react-native";
import { use, useRef, useState, type ComponentProps } from "react";
import {
  Platform,
  ScrollView,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { EmptyState } from "../../components/ui/EmptyState";
import { FloatingActionButton } from "../../components/ui/FloatingActionButton";
import { usePaneRole } from "../../components/ui/Pane";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { useAndroidControlSizing } from "../../components/ui/useAndroidControlSizing";
import { cn } from "../../lib/cn";
import {
  ANDROID_READING_MAX_WIDTH,
  deriveCenteredContentHorizontalPadding,
} from "../../lib/layout";
import { NATIVE_LIQUID_GLASS_SUPPORTED } from "../../native/native-glass";
import {
  useNativeColumnLayoutMetrics,
  useNativeLayoutMetrics,
} from "../../native/native-layout-metrics";
import { NativeScrollViewMarker } from "../../native/NativeScrollViewMarker";
import { useNativeWorkspaceColumnsSupported } from "../../native/NativeWorkspaceColumns";
import { nativeHeaderScrollEdgeEffects } from "../../native/scrollEdgeEffects";
import { NativePrimaryColumnContext } from "../../native/v5-workspace-context";
import type { WorkspaceState } from "../../state/workspaceModel";
import { relayEnvironmentDiscovery } from "../../state/relay";
import { useFabScroll } from "../home/FabScrollContext";
import { EnvironmentInviteCards } from "../members/EnvironmentInviteCards";
import { RoomListSection } from "../rooms/RoomListSection";
import { useSearchScrollRestoration } from "../workspace/useSearchScrollRestoration";
import { useWorkspaceTabs } from "../workspace/WorkspaceTabsContext";
import { useBotShareSheet } from "../members/BotShareSheet";
import { BotListRow, PinnedBotTiles } from "./BotListRow";
import { useBotNavigation, useSelectedBotKey } from "./useBotNavigation";
import { useBotRows } from "./useBotRows";
import { renderBotSidebarItem } from "./BotSidebarItem";
import { NewSectionRow, SidebarSectionsContext, useBotSidebarItems } from "./sidebarSections";
import { useWarmBotThreads } from "./useWarmBotThreads";

const ESTIMATED_BOT_ROW_HEIGHT = 72;

function deriveEmptyState(
  catalogState: WorkspaceState,
  projectCount: number,
  canCreateBots: boolean,
) {
  if (catalogState.isLoadingConnections) {
    return {
      title: "Loading environments",
      detail: "Checking saved environments on this device.",
      loading: true,
    };
  }
  if (!catalogState.hasConnections) {
    return {
      title: "No environments connected",
      detail: "Add an environment to load the bots running on it.",
      loading: false,
    };
  }
  if (
    (catalogState.connectionState === "available" ||
      catalogState.connectionState === "offline" ||
      catalogState.connectionState === "error" ||
      catalogState.connectionState === "unsupported") &&
    !catalogState.hasLoadedShellSnapshot
  ) {
    return {
      title:
        catalogState.connectionState === "unsupported"
          ? "Client not supported"
          : "Environment unavailable",
      detail:
        catalogState.connectionError ??
        "The saved environment is offline. Check the URL or start the environment, then retry.",
      loading: false,
    };
  }
  if (
    catalogState.hasConnectingEnvironment &&
    !catalogState.hasLoadedShellSnapshot &&
    catalogState.connectionError === null
  ) {
    return {
      title: "Connecting to environment",
      detail: "Loading bots from the saved environment.",
      loading: true,
    };
  }
  if (!canCreateBots) {
    return {
      title: "No bots shared with you",
      detail: "When someone shares a bot with you, it shows up here.",
      loading: false,
    };
  }
  return {
    title: "No bots yet",
    detail:
      projectCount === 0
        ? "Add a bot to start a conversation with it."
        : "Every bot is archived. Add one to start a conversation.",
    loading: false,
  };
}

function BotListScrollView(props: ComponentProps<typeof ScrollView>) {
  const primaryColumn = use(NativePrimaryColumnContext);
  const sidebarSurface = usePaneRole() === "sidebar" && primaryColumn !== null;
  if (Platform.OS !== "ios") return <ScrollView {...props} />;
  // Register the scroll view explicitly; layout and header siblings hide it from UIKit.
  return (
    <NativeScrollViewMarker
      style={{ flex: 1 }}
      scrollEdgeEffects={{
        ...nativeHeaderScrollEdgeEffects(Platform.OS, Platform.Version),
        top: Number.parseInt(String(Platform.Version), 10) >= 27 ? "automatic" : "soft",
      }}
    >
      <ScrollView
        {...props}
        // UIKit's scroll-edge material needs the scroll view's own surface color.
        className={cn(props.className, sidebarSurface ? "bg-drawer" : "bg-screen")}
      />
    </NativeScrollViewMarker>
  );
}

function renderBotListScrollView(props: ScrollViewProps) {
  // LegendList clones this with cells and ref; keep the marker inside its actual ScrollView.
  return <BotListScrollView {...props} />;
}

/** Narrows the list as the user types in the workspace search; matching is by bot name. */
export function filterBotRows(rows: ReadonlyArray<BotRow>, query: string) {
  const needle = query.trim().toLocaleLowerCase();
  return needle.length === 0
    ? rows
    : rows.filter((row) => row.name.toLocaleLowerCase().includes(needle));
}

/** Pinned bots lead as avatars; a search lists every match as a row. */
export function splitVisibleBotRows(rows: ReadonlyArray<BotRow>, query: string) {
  const visible = filterBotRows(rows, query);
  if (query.trim().length > 0) return { visible, pinned: [], listed: visible };
  const { pinned, unpinned } = splitPinnedBots(visible);
  return { visible, pinned, listed: unpinned };
}

/** Home: one list of every bot across linked environments. */
export function BotListScreen(props: {
  readonly visible: boolean;
  readonly searchQuery: string;
  readonly catalogState: WorkspaceState;
  readonly projectCount: number;
  readonly onAddConnection: () => void;
  readonly onAddBot: (() => void) | undefined;
}) {
  const { rows, threads, machineByEnvironmentId, showMachineBadges } = useBotRows(props.visible);
  useWarmBotThreads(rows);
  const inviteCount = useAtomValue(
    relayEnvironmentDiscovery.stateValueAtom,
    (state) => state.invites.length,
  );
  const share = useBotShareSheet();
  const botActions = { ...useBotNavigation(), onShare: share.onShare };
  const selectedKey = useSelectedBotKey(rows, threads);
  const usesNativeWorkspaceColumns = useNativeWorkspaceColumnsSupported();
  const workspace = useWorkspaceTabs();
  const [initialScrollOffset] = useState(() => workspace?.getScrollOffset("threads") ?? 0);
  const primaryColumn = use(NativePrimaryColumnContext);
  const sidebarSurface = usePaneRole() === "sidebar" && primaryColumn !== null;
  const contentBackground = sidebarSurface ? "bg-drawer" : "bg-screen";
  const containerClassName = cn(
    "flex-1",
    Platform.OS === "android" ? "bg-header" : contentBackground,
  );
  const columnMetrics = useNativeColumnLayoutMetrics();
  const screenMetrics = useNativeLayoutMetrics();
  const insets = useSafeAreaInsets();
  const { fabClearance } = useAndroidControlSizing();
  const contentSideInsets = usesNativeWorkspaceColumns
    ? (columnMetrics ?? screenMetrics)?.safeArea
    : undefined;
  // Wide Android lists need reading-width gutters to clear edges and camera cutouts.
  const { width: windowWidth } = useWindowDimensions();
  const androidListGutter =
    Platform.OS === "android"
      ? deriveCenteredContentHorizontalPadding({
          viewportWidth: windowWidth,
          maxContentWidth: ANDROID_READING_MAX_WIDTH,
          minimumPadding: 0,
        })
      : 0;
  const iosBottomClearance = Math.max(
    columnMetrics?.safeArea.bottom ?? insets.bottom,
    24,
    workspace?.bottomClearance ?? 0,
  );
  const onFabScroll = useFabScroll();
  const listRef = useRef<LegendListRef>(null);
  const restoredOffset = workspace?.state.tabs.threads.scrollOffset;
  useSearchScrollRestoration(workspace?.state.tabs.threads.searchMode, () => {
    if (restoredOffset === undefined) return;
    void listRef.current?.scrollToOffset({
      offset: restoredOffset - (Platform.OS === "ios" ? insets.top : 0),
      animated: false,
    });
  });
  const handleListScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    onFabScroll?.(event);
    workspace?.recordScrollOffset(
      "threads",
      Math.max(0, event.nativeEvent.contentOffset.y + (Platform.OS === "ios" ? insets.top : 0)),
    );
  };

  const { pinned, listed } = splitVisibleBotRows(rows, props.searchQuery);
  const sidebar = useBotSidebarItems({ rows, listed, searchQuery: props.searchQuery });

  if (rows.length === 0) {
    const empty = deriveEmptyState(
      props.catalogState,
      props.projectCount,
      props.onAddBot !== undefined,
    );
    // Someone who only has an invite answers it here instead of adding an environment.
    const invitesInstead = inviteCount > 0 && !props.catalogState.hasConnections;
    const canAddBot = props.catalogState.hasReadyEnvironment;
    const actionLabel = canAddBot ? "Add bot" : "Add environment";
    const onAction = canAddBot ? props.onAddBot : props.onAddConnection;
    const action = empty.loading ? undefined : onAction;
    return (
      <View className={containerClassName}>
        <ScreenContent surface={sidebarSurface ? "drawer" : "screen"}>
          <View
            className={cn(
              "flex-1 items-center justify-center px-8",
              Platform.OS !== "android" && contentBackground,
            )}
            style={{
              paddingBottom:
                Platform.OS === "ios" ? iosBottomClearance : Math.max(insets.bottom, 24),
              paddingTop: NATIVE_LIQUID_GLASS_SUPPORTED ? insets.top + 72 : 0,
              paddingLeft: 32 + (contentSideInsets?.left ?? 0),
              paddingRight: 32 + (contentSideInsets?.right ?? 0),
            }}
          >
            <View className="w-full max-w-[430px]">
              {inviteCount > 0 ? <EnvironmentInviteCards /> : null}
              {invitesInstead ? null : (
                <EmptyState
                  title={empty.title}
                  detail={empty.detail}
                  variant="plain"
                  {...(action === undefined
                    ? {}
                    : Platform.OS === "android"
                      ? {
                          action: (
                            <FloatingActionButton
                              label={actionLabel}
                              icon="plus"
                              variant="extended"
                              tone="primary"
                              onPress={action}
                            />
                          ),
                        }
                      : { actionLabel, onAction: action })}
                />
              )}
              {empty.loading && !invitesInstead ? (
                <View className="mt-4 items-center">
                  <AppActivityIndicator colorClassName="accent-icon-muted" />
                </View>
              ) : null}
            </View>
          </View>
        </ScreenContent>
      </View>
    );
  }

  const pinnedHeader =
    pinned.length > 0 ? (
      <PinnedBotTiles rows={pinned} selectedKey={selectedKey} {...botActions} />
    ) : null;
  return (
    <View className={containerClassName}>
      <ScreenContent surface="screen">
        <View className={cn("flex-1", Platform.OS !== "android" && contentBackground)}>
          <SidebarSectionsContext value={sidebar.api}>
            <LegendList
              ref={listRef}
              renderScrollComponent={Platform.OS === "ios" ? renderBotListScrollView : undefined}
              data={sidebar.items}
              keyExtractor={(item) => item.key}
              getItemType={(item) => item.type}
              extraData={selectedKey}
              renderItem={({ item }) =>
                renderBotSidebarItem(item, (row) => (
                  <BotListRow
                    row={row}
                    selected={row.key === selectedKey}
                    machineKind={machineByEnvironmentId.get(row.environmentId)}
                    showMachineBadge={showMachineBadges}
                    {...botActions}
                  />
                ))
              }
              estimatedItemSize={ESTIMATED_BOT_ROW_HEIGHT}
              recycleItems
              ListHeaderComponent={
                <>
                  {Platform.OS === "ios" ? null : <View className="h-4" />}
                  {pinnedHeader}
                </>
              }
              ListFooterComponent={
                <>
                  <RoomListSection
                    searchQuery={props.searchQuery}
                    placedKeys={sidebar.placedKeys}
                  />
                  <NewSectionRow searchQuery={props.searchQuery} />
                </>
              }
              ListEmptyComponent={
                pinned.length > 0 ? undefined : (
                  <EmptyState
                    title="No results"
                    detail={`No bots matching "${props.searchQuery}".`}
                    variant="plain"
                  />
                )
              }
              style={{ flex: 1 }}
              automaticallyAdjustsScrollIndicatorInsets={Platform.OS === "ios"}
              // UIKit owns the bar's inset, so a minimizing bar and a resized column move
              // the list in the same frame as the bar.
              contentInsetAdjustmentBehavior="automatic"
              contentInsetStartAdjustment={Platform.OS === "ios" ? insets.top : 0}
              scrollToOverflowEnabled
              initialScrollOffset={
                initialScrollOffset > 0
                  ? initialScrollOffset - (Platform.OS === "ios" ? insets.top : 0)
                  : undefined
              }
              showsVerticalScrollIndicator={false}
              keyboardDismissMode="on-drag"
              keyboardShouldPersistTaps="handled"
              onScroll={handleListScroll}
              scrollEventThrottle={16}
              contentContainerStyle={{
                paddingLeft: (contentSideInsets?.left ?? 0) + 8 + androidListGutter,
                paddingRight: (contentSideInsets?.right ?? 0) + 8 + androidListGutter,
                paddingBottom:
                  Platform.OS === "ios"
                    ? iosBottomClearance - (columnMetrics?.safeArea.bottom ?? insets.bottom)
                    : (workspace?.bottomClearance ?? Math.max(insets.bottom, 16) + fabClearance),
              }}
            />
          </SidebarSectionsContext>
        </View>
      </ScreenContent>
      {share.sheet}
    </View>
  );
}
