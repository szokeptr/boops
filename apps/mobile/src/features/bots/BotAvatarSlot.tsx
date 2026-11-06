import {
  hatchShapes,
  VISOR_CANVAS,
  type VisorShape,
  visorShapeKey,
  visorShapes,
  workingScanBox,
  workingScanDataUrl,
} from "@t3tools/client-runtime/bot-avatar";
import type { BotStatus } from "@t3tools/client-runtime/state/bot-list";
import type { ProjectAvatar } from "@t3tools/contracts";
import { specFor } from "@t3tools/shared/botAvatar";
import { Image } from "expo-image";
import { useMemo } from "react";
import { View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";

import { cn } from "../../lib/cn";

const SMALL = 24;

const STATUS_DOT_CLASS: Partial<Record<BotStatus, string>> = {
  "needs-you": "bg-warning-foreground",
  working: "bg-adaptive-sky-600-400",
};

function Shape({ shape }: { readonly shape: VisorShape }) {
  switch (shape.kind) {
    case "rect":
      return (
        <Rect
          x={shape.x}
          y={shape.y}
          width={shape.w}
          height={shape.h}
          rx={shape.r}
          fill={shape.fill}
          opacity={shape.opacity}
        />
      );
    case "circle":
      return <Circle cx={shape.cx} cy={shape.cy} r={shape.r} fill={shape.fill} />;
    case "path":
      return (
        <Path
          d={shape.d}
          fill={shape.fill ?? "none"}
          stroke={shape.stroke}
          strokeWidth={shape.strokeWidth}
          strokeLinecap={shape.linecap}
          strokeLinejoin="round"
          opacity={shape.opacity}
        />
      );
  }
}

/** The bot's Visor; the eyes carry the status and the working loop is an APNG over the visor. */
export function BotAvatarSlot(props: {
  readonly avatar: ProjectAvatar | null;
  readonly name: string;
  readonly status: BotStatus;
  /** Points square. Below 24 the accessory drops and a dot carries the status. */
  readonly size: number;
}) {
  const { avatar, name, status, size } = props;
  const look = useMemo(() => avatar ?? specFor(name), [avatar, name]);
  const shapes = useMemo(
    () =>
      status === "hatching"
        ? hatchShapes(look, "egg")
        : visorShapes(look, status, { includeAccessory: size >= SMALL }),
    [look, status, size],
  );
  const dotClass = size < SMALL ? STATUS_DOT_CLASS[status] : undefined;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size }}
    >
      <Svg width={size} height={size} viewBox={`0 0 ${VISOR_CANVAS} ${VISOR_CANVAS}`}>
        {shapes.map((shape) => (
          <Shape key={visorShapeKey(shape)} shape={shape} />
        ))}
      </Svg>
      {status === "working" ? (
        <Image
          source={{ uri: workingScanDataUrl(look) }}
          style={{ position: "absolute", ...workingScanBox(size) }}
        />
      ) : null}
      {dotClass ? (
        <View
          className={cn("absolute rounded-full", dotClass)}
          style={{ right: -2, bottom: -2, width: 6, height: 6 }}
        />
      ) : null}
    </View>
  );
}
