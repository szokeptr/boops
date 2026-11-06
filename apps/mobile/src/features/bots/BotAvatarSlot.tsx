import {
  hatchGrid,
  screenieGrid,
  screeniePalette,
  spriteRects,
} from "@t3tools/client-runtime/bot-avatar";
import type { BotStatus } from "@t3tools/client-runtime/state/bot-list";
import type { ProjectAvatar } from "@t3tools/contracts";
import { specFor } from "@t3tools/shared/botAvatar";
import { useMemo } from "react";
import { View } from "react-native";
import Svg, { Rect } from "react-native-svg";

import { cn } from "../../lib/cn";

/** Pixel art stays even only at whole multiples of the 16-cell sprite. */
export type BotAvatarSize = 16 | 32 | 48 | 64;

const STATUS_DOT_CLASS: Partial<Record<BotStatus, string>> = {
  "needs-you": "bg-warning-foreground",
  working: "bg-adaptive-sky-600-400",
};

/**
 * The bot's Screenie, drawn still. Web loops the working dashes as an APNG; that cost is
 * unmeasured in React Native, so mobile shows the working face's static dashes instead.
 */
export function BotAvatarSlot(props: {
  readonly avatar: ProjectAvatar | null;
  readonly name: string;
  readonly status: BotStatus;
  readonly size: BotAvatarSize;
}) {
  const { avatar, name, status, size } = props;
  const rects = useMemo(() => {
    const look = avatar ?? specFor(name);
    const grid = status === "hatching" ? hatchGrid(look, "egg") : screenieGrid(look, status);
    return spriteRects(grid, screeniePalette(look));
  }, [avatar, name, status]);
  // From 32pt up the row's status label carries the state; smaller slots have no room for one.
  const dotClass = size < 32 ? STATUS_DOT_CLASS[status] : undefined;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size }}
    >
      <Svg width={size} height={size} viewBox="0 0 16 16">
        {rects.map((rect) => (
          <Rect
            key={`${rect.x}:${rect.y}`}
            x={rect.x}
            y={rect.y}
            width={rect.width}
            height={1}
            fill={rect.fill}
          />
        ))}
      </Svg>
      {dotClass ? (
        <View
          className={cn("absolute", dotClass)}
          style={{ right: -2, bottom: -2, width: 6, height: 6 }}
        />
      ) : null}
    </View>
  );
}
