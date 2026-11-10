import {
  AVATAR_ACCESSORY_MIN_SIZE,
  AVATAR_CANVAS,
  type AvatarShape,
  avatarShapeKey,
  avatarShapes,
  hatchShapes,
  workingDotsBox,
  workingDotsDataUrl,
} from "@t3tools/client-runtime/bot-avatar";
import type { BotStatus } from "@t3tools/client-runtime/state/bot-list";
import type { ProjectAvatar } from "@t3tools/contracts";
import { lookFor } from "@t3tools/shared/botAvatar";
import { Image } from "expo-image";
import { useMemo } from "react";
import { View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";

import { useReduceMotionEnabled } from "../../lib/appState";
import { cn } from "../../lib/cn";

const STATUS_DOT_CLASS: Partial<Record<BotStatus, string>> = {
  "needs-you": "bg-warning-foreground",
  working: "bg-adaptive-sky-600-400",
};

/** One piece of a bot's drawing, in the avatar canvas's coordinates. */
export function BotAvatarShape({ shape }: { readonly shape: AvatarShape }) {
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
          {...(shape.transform ? { transform: shape.transform } : {})}
        />
      );
  }
}

/** The bot's blob; the face carries the status and the working dots are an APNG over it. */
export function BotAvatarSlot(props: {
  readonly avatar: ProjectAvatar | null;
  readonly name: string;
  readonly status: BotStatus;
  /** Points square. Below 24 the accessory drops and a dot carries the status. */
  readonly size: number;
  /** False holds the working dots still; defaults to following Reduce Motion. */
  readonly animate?: boolean;
}) {
  const { avatar, name, status, size } = props;
  const reduceMotion = useReduceMotionEnabled();
  const animate = props.animate ?? !reduceMotion;
  const look = useMemo(() => lookFor(avatar, name), [avatar, name]);
  const shapes = useMemo(
    () =>
      status === "hatching" ? hatchShapes(look, "egg", size) : avatarShapes(look, status, size),
    [look, status, size],
  );
  const dotClass = size < AVATAR_ACCESSORY_MIN_SIZE ? STATUS_DOT_CLASS[status] : undefined;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size }}
    >
      <Svg width={size} height={size} viewBox={`0 0 ${AVATAR_CANVAS} ${AVATAR_CANVAS}`}>
        {shapes.map((shape) => (
          <BotAvatarShape key={avatarShapeKey(shape)} shape={shape} />
        ))}
      </Svg>
      {status === "working" ? (
        <Image
          // expo-image reads autoplay only when the image is set, so a change remounts it.
          key={animate ? "play" : "still"}
          source={{ uri: workingDotsDataUrl() }}
          autoplay={animate}
          style={{ position: "absolute", ...workingDotsBox(look, size) }}
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
