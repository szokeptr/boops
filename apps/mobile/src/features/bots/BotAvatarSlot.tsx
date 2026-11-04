import { botMonogram, type BotStatus } from "@t3tools/client-runtime/state/bot-list";
import type { ProjectAvatar } from "@t3tools/contracts";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";

export type BotAvatarSize = 16 | 32 | 48 | 64;

const SIZE_STYLE: Record<
  BotAvatarSize,
  { readonly radius: number; readonly fontSize: number; readonly dot: number }
> = {
  16: { radius: 4, fontSize: 7, dot: 6 },
  32: { radius: 8, fontSize: 12, dot: 0 },
  48: { radius: 12, fontSize: 17, dot: 0 },
  64: { radius: 14, fontSize: 22, dot: 0 },
};

const STATUS_DOT_CLASS: Partial<Record<BotStatus, string>> = {
  "needs-you": "bg-warning-foreground",
  working: "bg-adaptive-sky-600-400",
};

/**
 * Where a bot's avatar renders. A monogram stands in until a native Screenie renderer is measured
 * on device (APNG cost in React Native is unverified); it will take these same props. No looping
 * animation.
 */
export function BotAvatarSlot(props: {
  readonly avatar: ProjectAvatar | null;
  readonly name: string;
  readonly status: BotStatus;
  readonly size: BotAvatarSize;
}) {
  const style = SIZE_STYLE[props.size];
  // From 32pt up the row's status label carries the state; smaller slots have no room for one.
  const dotClass = style.dot > 0 ? STATUS_DOT_CLASS[props.status] : undefined;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="items-center justify-center bg-subtle"
      style={{ width: props.size, height: props.size, borderRadius: style.radius }}
    >
      <Text
        allowFontScaling={false}
        className="font-t3-bold text-foreground-muted"
        style={{ fontSize: style.fontSize, lineHeight: style.fontSize * 1.2 }}
      >
        {botMonogram(props.name)}
      </Text>
      {dotClass ? (
        <View
          className={cn("absolute", dotClass)}
          style={{ right: -1, bottom: -1, width: style.dot, height: style.dot }}
        />
      ) : null}
    </View>
  );
}
