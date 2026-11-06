import { LegendList } from "@legendapp/list/react-native";
import type { NativeStackHeaderItem } from "@react-navigation/native-stack";
import { useRef, useState } from "react";
import type { LayoutChangeEvent, TextInputInstance } from "react-native";
import { Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SearchBarCommands } from "react-native-screens";

import { CompactBrandTitle } from "../../components/CompactBrandTitle";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { useAndroidControlSizing } from "../../components/ui/useAndroidControlSizing";
import { NATIVE_LIQUID_GLASS_SUPPORTED } from "../../native/native-glass";
import { NativeScrollView } from "../../native/NativeScrollViewMarker";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useWorkspaceState } from "../../state/workspace";
import {
  getConnectionAwareBrandHeaderOptions,
  WorkspaceConnectionTitle,
} from "../home/WorkspaceConnectionTitle";
import { useHardwareKeyboardCommand } from "../keyboard/hardwareKeyboardCommands";
import { withNativeGlassHeaderItem } from "../layout/native-glass-header-items";
import {
  useAndroidFloatingTabs,
  useAppearancePreferences,
} from "../settings/appearance/AppearancePreferencesProvider";
import { SidebarNavigationShell } from "../threads/sidebar-navigation-shell";
import { FLOATING_TABS } from "../workspace/floating-workspace-tabs";
import { splitVisibleBotRows } from "./BotListScreen";
import { BotListRow, PinnedBotTiles } from "./BotListRow";
import { BotListToolbar } from "./BotListToolbar";
import { useBotNavigation, useSelectedBotKey } from "./useBotNavigation";
import { useBotRows } from "./useBotRows";

const SIDEBAR_STICKY_HEADER_HEIGHT = 106;

interface BotNavigationSidebarProps {
  readonly width: number;
  readonly visible: boolean;
  readonly searchQuery: string;
  readonly onSearchQueryChange: (query: string) => void;
  readonly onOpenSettings: () => void;
  readonly onOpenEnvironmentSettings: () => void;
  readonly onAddBot: () => void;
  readonly onRequestVisibility: () => void;
}

/** The bot list in the workspace's sidebar column. */
export function BotNavigationSidebar(props: BotNavigationSidebarProps) {
  if (Platform.OS !== "ios") return <BotNavigationSidebarPane {...props} nativeChrome={false} />;
  return (
    <View
      className="flex-1 border-border bg-drawer"
      style={{ borderRightWidth: StyleSheet.hairlineWidth, width: props.width }}
    >
      <SidebarNavigationShell>
        <BotNavigationSidebarPane {...props} nativeChrome />
      </SidebarNavigationShell>
    </View>
  );
}

function headerButton(input: {
  readonly label: string;
  readonly icon: string;
  readonly onPress: () => void;
}): NativeStackHeaderItem {
  return withNativeGlassHeaderItem({
    type: "button",
    axisBehavior: "horizontalOnly",
    label: input.label,
    accessibilityLabel: input.label,
    icon: { type: "sfSymbol" as const, name: input.icon as never },
    onPress: input.onPress,
  });
}

function FallbackHeaderButton(props: {
  readonly accessibilityLabel: string;
  readonly icon: "gearshape" | "plus";
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      className="size-11 items-center justify-center rounded-full bg-subtle active:opacity-70"
      accessibilityLabel={props.accessibilityLabel}
      accessibilityRole="button"
      hitSlop={4}
      onPress={props.onPress}
    >
      <SymbolView
        name={props.icon}
        size={18}
        tintColorClassName="accent-foreground"
        type="monochrome"
      />
    </Pressable>
  );
}

function BotNavigationSidebarPane(
  props: BotNavigationSidebarProps & { readonly nativeChrome: boolean },
) {
  const floatingTabsEnabled = useAndroidFloatingTabs();
  const { themeVariables: materialTheme } = useAppearancePreferences();
  const insets = useSafeAreaInsets();
  const { fabClearance, fabSize } = useAndroidControlSizing();
  const { state: catalogState } = useWorkspaceState();
  const { rows, threads, machineByEnvironmentId, showMachineBadges } = useBotRows();
  const botActions = useBotNavigation();
  const selectedKey = useSelectedBotKey(rows, threads);
  const { visible: visibleRows, pinned, listed } = splitVisibleBotRows(rows, props.searchQuery);
  const pinnedHeader =
    pinned.length > 0 ? (
      <PinnedBotTiles rows={pinned} selectedKey={selectedKey} {...botActions} />
    ) : undefined;
  const searchInputRef = useRef<TextInputInstance>(null);
  const searchBarRef = useRef<SearchBarCommands>(null);
  const [measuredHeaderHeight, setMeasuredHeaderHeight] = useState<number | null>(null);
  const topListInset = (measuredHeaderHeight ?? insets.top + SIDEBAR_STICKY_HEADER_HEIGHT) + 6;
  const handleStickyHeaderLayout = (event: LayoutChangeEvent) => {
    const nextHeight = event.nativeEvent.layout.height;
    setMeasuredHeaderHeight((current) => (current === nextHeight ? current : nextHeight));
  };
  const focusSearch = () => {
    if (Platform.OS === "android") return false;
    const focus = () =>
      props.nativeChrome ? searchBarRef.current?.focus() : searchInputRef.current?.focus();
    if (!props.visible) {
      props.onRequestVisibility();
      setTimeout(focus, 240);
    } else {
      focus();
    }
    return true;
  };
  useHardwareKeyboardCommand("focusSearch", focusSearch);

  const listEmpty = (
    <Text
      className={
        Platform.OS === "android"
          ? "px-4 py-4 text-center text-sm text-drawer-foreground-muted"
          : "px-2 py-4 text-sm text-drawer-foreground-muted"
      }
    >
      {catalogState.isLoadingConnections
        ? "Loading bots…"
        : !catalogState.hasConnections
          ? "No environments connected"
          : props.searchQuery.trim().length > 0
            ? "No matching bots"
            : "No bots yet"}
    </Text>
  );
  const renderItem = ({ item }: { readonly item: (typeof rows)[number] }) => (
    <BotListRow
      row={item}
      selected={item.key === selectedKey}
      machineKind={machineByEnvironmentId.get(item.environmentId)}
      showMachineBadge={showMachineBadges}
      {...botActions}
    />
  );

  if (props.nativeChrome) {
    const headerItems = [
      headerButton({ label: "Add bot", icon: "plus", onPress: props.onAddBot }),
      headerButton({ label: "Settings", icon: "gearshape", onPress: props.onOpenSettings }),
    ];
    return (
      <>
        <NativeStackScreenOptions
          optionsVersion={[props.width, props.onAddBot, props.onOpenSettings]}
          options={{
            ...getConnectionAwareBrandHeaderOptions({
              headerWidth: props.width,
              trailingItemCount: headerItems.length,
              onOpenEnvironments: props.onOpenEnvironmentSettings,
              fallbackTitleStyle: { fontSize: 18, fontWeight: "800" },
            }),
            headerSearchBarOptions: {
              ref: searchBarRef,
              autoCapitalize: "none",
              hideNavigationBar: false,
              hideWhenScrolling: false,
              obscureBackground: false,
              placeholder: "Search",
              placement: "stacked",
              onCancelButtonPress: () => props.onSearchQueryChange(""),
              onChangeText: (event) => props.onSearchQueryChange(event.nativeEvent.text),
            },
            unstable_headerRightItems: () => headerItems,
          }}
        />
        <LegendList
          renderScrollComponent={NativeScrollView}
          data={listed}
          keyExtractor={(row) => row.key}
          extraData={selectedKey}
          renderItem={renderItem}
          estimatedItemSize={64}
          recycleItems
          automaticallyAdjustsScrollIndicatorInsets={NATIVE_LIQUID_GLASS_SUPPORTED}
          contentInsetAdjustmentBehavior={NATIVE_LIQUID_GLASS_SUPPORTED ? "automatic" : "never"}
          contentContainerStyle={{
            paddingHorizontal: 8,
            paddingBottom: Math.max(insets.bottom, 16) + 16,
            paddingTop: 6,
          }}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          style={{ flex: 1 }}
          ListHeaderComponent={pinnedHeader}
          ListEmptyComponent={pinned.length > 0 ? undefined : listEmpty}
        />
      </>
    );
  }

  return (
    <View
      className={
        Platform.OS === "android" ? "flex-1 bg-header" : "flex-1 border-r border-border bg-drawer"
      }
      // Android fills its pane, which animates its width while a hinge resizes the split.
      style={Platform.OS === "android" ? undefined : { width: props.width }}
    >
      <View
        className="flex-1"
        style={
          Platform.OS === "android"
            ? {
                marginHorizontal: 4,
                paddingBottom: insets.bottom,
                backgroundColor: materialTheme["--color-drawer"],
                borderTopLeftRadius: 28,
                borderTopRightRadius: 28,
                overflow: "hidden",
              }
            : { paddingBottom: insets.bottom }
        }
      >
        {Platform.OS === "android" && visibleRows.length === 0 ? (
          <View className="flex-1 items-center justify-center">{listEmpty}</View>
        ) : (
          // oxlint-disable-next-line t3code/require-registered-list-scroll -- Only the non-native workspace layout (Android and the fallback) renders this pane, which has no native header to register with.
          <LegendList
            data={listed}
            keyExtractor={(row) => row.key}
            extraData={selectedKey}
            renderItem={renderItem}
            estimatedItemSize={64}
            recycleItems
            contentContainerStyle={{
              paddingHorizontal: Platform.OS === "android" ? 0 : 8,
              paddingBottom:
                Platform.OS === "android"
                  ? floatingTabsEnabled
                    ? FLOATING_TABS.bottom + FLOATING_TABS.edge + fabSize
                    : Math.max(insets.bottom, 16) + fabClearance - insets.bottom
                  : 16 + insets.bottom,
              paddingTop: Platform.OS === "android" ? 6 : topListInset,
            }}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={{ flex: 1 }}
            ListHeaderComponent={pinnedHeader}
            ListEmptyComponent={pinned.length > 0 ? undefined : listEmpty}
          />
        )}
      </View>

      {Platform.OS === "android" ? (
        <BotListToolbar
          searchQuery={props.searchQuery}
          onSearchQueryChange={props.onSearchQueryChange}
          onOpenEnvironments={props.onOpenEnvironmentSettings}
          onRequestVisibility={props.onRequestVisibility}
        />
      ) : (
        <View
          className="absolute inset-x-0 top-0 z-[4] bg-drawer"
          collapsable={false}
          onLayout={handleStickyHeaderLayout}
          pointerEvents="auto"
          style={{ paddingTop: insets.top }}
        >
          <View className="h-[50px] flex-row items-end gap-0.5 pr-2 pl-5">
            <WorkspaceConnectionTitle
              grow
              onPress={props.onOpenEnvironmentSettings}
              size="pageTitle"
              brand={
                <View className="h-11 flex-1 justify-center">
                  <CompactBrandTitle allowFontScaling={false} />
                </View>
              }
            />
            <View className="flex-row items-center gap-2.5">
              <FallbackHeaderButton
                accessibilityLabel="Add bot"
                icon="plus"
                onPress={props.onAddBot}
              />
              <FallbackHeaderButton
                accessibilityLabel="Open settings"
                icon="gearshape"
                onPress={props.onOpenSettings}
              />
            </View>
          </View>
          <View className="mx-4 mt-[9px] h-[38px] flex-row items-center gap-1.5 rounded-xl bg-sidebar-search pr-2.5 pl-[11px]">
            <SymbolView
              name="magnifyingglass"
              size={15}
              tintColorClassName="accent-drawer-foreground-muted"
              type="monochrome"
            />
            <TextInput
              ref={searchInputRef}
              accessibilityLabel="Search bots"
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
              onChangeText={props.onSearchQueryChange}
              placeholder="Search"
              placeholderTextColorClassName="accent-placeholder"
              selectionColorClassName={undefined}
              cursorColorClassName={undefined}
              selectionHandleColorClassName={undefined}
              returnKeyType="search"
              className="h-[34px] flex-1 px-0 py-0 font-sans text-base text-drawer-foreground"
              value={props.searchQuery}
            />
          </View>
        </View>
      )}
    </View>
  );
}
