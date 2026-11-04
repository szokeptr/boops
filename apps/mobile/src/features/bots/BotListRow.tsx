import type { BotRow, BotStatus } from "@t3tools/client-runtime/state/bot-list";
import type { EnvironmentMachineKind } from "@t3tools/contracts";
import { Pressable, View } from "react-native";

import { EnvironmentMachineSymbol } from "../../components/EnvironmentMachineSymbol";
import { RelativeTime } from "../../components/RelativeTime";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";
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

export function BotListRow(props: {
  readonly row: BotRow;
  readonly selected: boolean;
  readonly machineKind: EnvironmentMachineKind | undefined;
  readonly showMachineBadge: boolean;
  readonly onOpen: (row: BotRow) => void;
  readonly onOpenActivity: (row: BotRow) => void;
}) {
  const { row, selected } = props;
  const foreground = selected ? "text-thread-selected-foreground" : "text-foreground";
  const muted = selected ? "text-thread-selected-foreground-muted" : "text-foreground-muted";
  const mutedTint = selected
    ? "accent-thread-selected-foreground-muted"
    : "accent-foreground-muted";
  const statusShown = row.status === "needs-you" || row.status === "working";
  return (
    <View className={cn("flex-row items-center rounded-xl", selected && "bg-thread-selected")}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={botRowLabel(row)}
        accessibilityState={{ selected }}
        className="min-w-0 flex-1 flex-row items-center gap-3 rounded-xl py-2.5 pl-3 active:opacity-70"
        onPress={() => props.onOpen(row)}
      >
        <BotAvatarSlot avatar={row.avatar} name={row.name} status={row.status} size={32} />
        <View className="min-w-0 flex-1 gap-0.5">
          <View className="flex-row items-baseline gap-2">
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
            <Text className={cn("text-xs tabular-nums", muted)}>
              <RelativeTime timestamp={row.lastActivityAt} />
            </Text>
          </View>
          <View className="flex-row items-center gap-1.5">
            {statusShown ? (
              <View className="flex-1">
                <BotStatusLabel status={row.status} />
              </View>
            ) : (
              <Text
                numberOfLines={1}
                className={cn("min-w-0 flex-1 text-sm", row.unread ? foreground : muted)}
              >
                {row.lastMessagePreview === null
                  ? "No messages yet"
                  : row.lastMessageFromUser
                    ? `You: ${row.lastMessagePreview}`
                    : row.lastMessagePreview}
              </Text>
            )}
            {row.unread ? <UnreadDot /> : null}
            {props.showMachineBadge && props.machineKind ? (
              <EnvironmentMachineSymbol
                kind={props.machineKind}
                size={12}
                tintColorClassName={mutedTint}
              />
            ) : null}
          </View>
        </View>
      </Pressable>
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
