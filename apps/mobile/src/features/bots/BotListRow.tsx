import type { BotRow, BotStatus } from "@t3tools/client-runtime/state/bot-list";
import type { EnvironmentMachineKind } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import type { ReactNode } from "react";
import { Platform, Pressable, View, type ViewStyle } from "react-native";

import { EnvironmentMachineSymbol } from "../../components/EnvironmentMachineSymbol";
import { RelativeTime } from "../../components/RelativeTime";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { Menu } from "../../components/ui/Menu";
import { cn } from "../../lib/cn";
import { memberEnvironment, useIsMemberEnvironment } from "../../state/members";
import { BotAvatarSlot } from "./BotAvatarSlot";

const STATUS_PRESENTATION = {
  "needs-you": {
    label: "Needs you",
    className: "text-warning-foreground",
    dotClassName: "bg-warning-foreground",
  },
  working: {
    label: "Working",
    className: "text-adaptive-sky-600-400",
    dotClassName: "bg-adaptive-sky-600-400",
  },
} as const;

/** Only needs-you and working get a label; callers show the last message otherwise. */
export function BotStatusLabel(props: { readonly status: BotStatus }) {
  if (props.status !== "needs-you" && props.status !== "working") return null;
  const presentation = STATUS_PRESENTATION[props.status];
  return (
    <View className="flex-row items-center gap-1.5">
      <View className={cn("size-1.5 rounded-full", presentation.dotClassName)} />
      <Text className={cn("text-xs font-t3-bold", presentation.className)}>
        {presentation.label}
      </Text>
    </View>
  );
}

export function UnreadDot() {
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="Unread"
      className="size-2 rounded-full bg-primary"
    />
  );
}

function botRowLabel(row: BotRow): string {
  const status =
    row.status === "needs-you" ? "needs you" : row.status === "working" ? "working" : null;
  return [
    row.name,
    status,
    row.unread ? "unread" : null,
    row.lastMessagePreview,
    row.machineLabel === null ? null : `on ${row.machineLabel}`,
  ]
    .filter((part) => part !== null)
    .join(", ");
}

function botPreview(row: BotRow): string {
  if (row.lastMessagePreview === null) return "No messages yet";
  return row.lastMessageFromUser ? `You: ${row.lastMessagePreview}` : row.lastMessagePreview;
}

export interface BotEntryActions {
  readonly onOpen: (row: BotRow) => void;
  readonly onOpenActivity: (row: BotRow) => void;
  readonly onSetPinned: (row: BotRow, pinned: boolean) => void;
  readonly onShare?: (row: BotRow) => void;
}

/** Long-press on a bot: pin or unpin it, share it, or open its activity. */
function BotEntryMenu(
  props: BotEntryActions & {
    readonly row: BotRow;
    readonly children: ReactNode;
    readonly style?: ViewStyle;
  },
) {
  const { row } = props;
  const pinned = row.pinnedAt !== null;
  // A member's device chats with someone else's bot: pinning and sharing stay with the owner.
  const member = useIsMemberEnvironment(row.environmentId);
  const canShare = useAtomValue(memberEnvironment.setBotAccess.permissionAtom(row.environmentId));
  const actions = [
    ...(member
      ? []
      : [
          pinned
            ? {
                id: "unpin",
                title: "Unpin",
                image: Platform.OS === "ios" ? "pin.slash" : "keep_off",
              }
            : { id: "pin", title: "Pin", image: Platform.OS === "ios" ? "pin" : "keep" },
        ]),
    ...(props.onShare && canShare && !member
      ? [{ id: "share", title: "Share…", image: Platform.OS === "ios" ? "person.2" : "group" }]
      : []),
    ...(row.activityThreadCount > 0
      ? [
          {
            id: "activity",
            title: `Activity (${row.activityThreadCount})`,
            image: Platform.OS === "ios" ? "clock" : "history",
          },
        ]
      : []),
  ];
  return (
    <Menu
      actions={actions}
      shouldOpenOnLongPress
      {...(props.style ? { style: props.style } : {})}
      onPressAction={({ nativeEvent }) => {
        if (nativeEvent.event === "pin" || nativeEvent.event === "unpin") {
          props.onSetPinned(row, !pinned);
        }
        if (nativeEvent.event === "activity") props.onOpenActivity(row);
        if (nativeEvent.event === "share") props.onShare?.(row);
      }}
    >
      {props.children}
    </Menu>
  );
}

export function BotListRow(
  props: BotEntryActions & {
    readonly row: BotRow;
    readonly selected: boolean;
    readonly machineKind: EnvironmentMachineKind | undefined;
    readonly showMachineBadge: boolean;
  },
) {
  const { row, selected } = props;
  const foreground = selected ? "text-thread-selected-foreground" : "text-foreground";
  const muted = selected ? "text-thread-selected-foreground-muted" : "text-foreground-muted";
  const mutedTint = selected
    ? "accent-thread-selected-foreground-muted"
    : "accent-foreground-muted";
  return (
    <View className={cn("flex-row items-center rounded-xl", selected && "bg-thread-selected")}>
      <BotEntryMenu {...props} style={{ flex: 1 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={botRowLabel(row)}
          accessibilityState={{ selected }}
          className="min-w-0 flex-1 flex-row items-center gap-3 rounded-xl py-2 pl-2 active:opacity-70"
          onPress={() => props.onOpen(row)}
        >
          <BotAvatarSlot avatar={row.avatar} name={row.name} status={row.status} size={44} />
          <View className="min-w-0 flex-1 gap-0.5">
            <View className="flex-row items-center gap-2">
              <Text
                numberOfLines={1}
                className={cn(
                  "min-w-0 flex-1 text-base",
                  row.unread ? "font-t3-bold" : "font-t3-medium",
                  foreground,
                )}
              >
                {row.name}
              </Text>
              {props.showMachineBadge && props.machineKind ? (
                <EnvironmentMachineSymbol
                  kind={props.machineKind}
                  size={12}
                  tintColorClassName={mutedTint}
                />
              ) : null}
              <Text className={cn("text-xs tabular-nums", muted)}>
                <RelativeTime timestamp={row.lastActivityAt} />
              </Text>
            </View>
            <Text
              numberOfLines={1}
              className={cn("min-w-0 text-sm", row.unread ? foreground : muted)}
            >
              {botPreview(row)}
            </Text>
          </View>
        </Pressable>
      </BotEntryMenu>
      {row.activityThreadCount > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${row.name} activity (${row.activityThreadCount})`}
          hitSlop={4}
          className="h-11 min-w-11 flex-row items-center justify-center gap-0.5 rounded-lg px-2 active:opacity-70"
          onPress={() => props.onOpenActivity(row)}
        >
          <SymbolView name="clock" size={13} tintColorClassName={mutedTint} type="monochrome" />
          <Text className={cn("text-xs tabular-nums", muted)}>{row.activityThreadCount}</Text>
        </Pressable>
      ) : (
        <View className="w-3" />
      )}
    </View>
  );
}

/** Pinned bots as large avatars above the list, in pin order. */
export function PinnedBotTiles(
  props: BotEntryActions & {
    readonly rows: ReadonlyArray<BotRow>;
    readonly selectedKey: string | null;
  },
) {
  return (
    <View accessibilityLabel="Pinned bots" className="flex-row flex-wrap justify-center pb-2">
      {props.rows.map((row) => {
        const selected = row.key === props.selectedKey;
        return (
          <View key={row.key} className="w-20 p-0.5">
            <BotEntryMenu {...props} row={row}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={botRowLabel(row)}
                accessibilityState={{ selected }}
                className={cn(
                  "items-center rounded-xl px-1 pt-2 pb-1.5 active:opacity-70",
                  selected && "bg-thread-selected",
                )}
                onPress={() => props.onOpen(row)}
              >
                <View>
                  <BotAvatarSlot
                    avatar={row.avatar}
                    name={row.name}
                    status={row.status}
                    size={52}
                  />
                  {row.unread ? (
                    <View className="absolute top-0 right-0 size-2.5 rounded-full bg-primary" />
                  ) : null}
                </View>
                <Text
                  numberOfLines={1}
                  className={cn(
                    "-mt-1 text-xs",
                    row.unread ? "font-t3-bold" : "font-t3-medium",
                    selected ? "text-thread-selected-foreground" : "text-foreground",
                  )}
                >
                  {row.name}
                </Text>
              </Pressable>
            </BotEntryMenu>
          </View>
        );
      })}
    </View>
  );
}
