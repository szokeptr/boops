import { AVATAR_CANVAS, avatarShapeKey, avatarShapes } from "@t3tools/client-runtime/bot-avatar";
import type { ProjectAvatar, ProjectId, RoomParticipantView } from "@t3tools/contracts";
import { lookFor } from "@t3tools/shared/botAvatar";
import { useId } from "react";
import { View } from "react-native";
import { useResolveClassNames } from "uniwind";
import Svg, {
  Circle,
  ClipPath,
  Defs,
  G,
  LinearGradient,
  Mask,
  Path,
  Rect,
  Stop,
} from "react-native-svg";

import { BotAvatarShape } from "../bots/BotAvatarSlot";
import { roomAvatarFaces } from "./roomPresentation";

type Face =
  | { readonly kind: "bot"; readonly name: string; readonly avatar: ProjectAvatar | null }
  | {
      readonly kind: "person";
    };

/** Unique per instance, and safe inside `url(#…)`. */
function useSvgId(prefix: string) {
  return `${prefix}${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
}

function BotFace(props: { readonly face: Extract<Face, { kind: "bot" }>; readonly size: number }) {
  const look = lookFor(props.face.avatar, props.face.name);
  const shapes = avatarShapes(look, "idle", props.size);
  return (
    <G transform={`scale(${props.size / AVATAR_CANVAS})`}>
      {shapes.map((shape) => (
        <BotAvatarShape key={avatarShapeKey(shape)} shape={shape} />
      ))}
    </G>
  );
}

/** A contact silhouette, since people have no picture here. */
function PersonShape(props: { readonly size: number; readonly id: string }) {
  const tone = String(useResolveClassNames("text-foreground-muted").color ?? "#838383");
  const scale = props.size / 32;
  return (
    <G transform={`scale(${scale})`}>
      <Defs>
        <LinearGradient id={`${props.id}g`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={tone} stopOpacity={0.45} />
          <Stop offset="1" stopColor={tone} stopOpacity={0.75} />
        </LinearGradient>
        <ClipPath id={`${props.id}c`}>
          <Circle cx={16} cy={16} r={16} />
        </ClipPath>
      </Defs>
      <G clipPath={`url(#${props.id}c)`}>
        <Rect x={0} y={0} width={32} height={32} fill={`url(#${props.id}g)`} />
        <Circle cx={16} cy={12.5} r={5.5} fill="#ffffff" />
        <Path d="M5.5 29.5c1.2-6 5.4-9.5 10.5-9.5s9.3 3.5 10.5 9.5z" fill="#ffffff" />
      </G>
    </G>
  );
}

function FaceShape(props: { readonly face: Face; readonly size: number; readonly id: string }) {
  return props.face.kind === "bot" ? (
    <BotFace face={props.face} size={props.size} />
  ) : (
    <PersonShape size={props.size} id={props.id} />
  );
}

/**
 * A group chat's picture, as phones draw one: a larger face up top and a smaller one tucked in
 * below, with a notch cut where they meet so they stay apart on any background.
 */
export function GroupAvatar(props: { readonly faces: ReadonlyArray<Face>; readonly size: number }) {
  const id = useSvgId("room");
  const { size } = props;
  const [first, second] = props.faces;
  const big = Math.round(size * 0.7);
  const small = Math.round(size * 0.5);
  const smallAt = size - small;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size }}
    >
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {first === undefined ? null : second === undefined ? (
          <FaceShape face={first} size={size} id={`${id}a`} />
        ) : (
          <>
            <Defs>
              <Mask id={`${id}m`} maskUnits="userSpaceOnUse" x={0} y={0} width={size} height={size}>
                <Rect x={0} y={0} width={size} height={size} fill="#ffffff" />
                <Circle
                  cx={smallAt + small / 2}
                  cy={smallAt + small / 2}
                  r={small / 2 + 2}
                  fill="#000000"
                />
              </Mask>
            </Defs>
            <G mask={`url(#${id}m)`}>
              <FaceShape face={first} size={big} id={`${id}a`} />
            </G>
            <G transform={`translate(${smallAt} ${smallAt})`}>
              <FaceShape face={second} size={small} id={`${id}b`} />
            </G>
          </>
        )}
      </Svg>
    </View>
  );
}

/** One person, the size of a bot's avatar: the picker's tile for people. */
export function PersonAvatar(props: { readonly size: number }) {
  return <GroupAvatar faces={[{ kind: "person" }]} size={props.size} />;
}

/** A room's group avatar from its participants. */
export function RoomAvatar(props: {
  readonly participants: ReadonlyArray<RoomParticipantView>;
  readonly viewerKey: string;
  readonly avatarOf: (projectId: ProjectId) => ProjectAvatar | null;
  readonly size: number;
}) {
  const faces = roomAvatarFaces(props.participants, props.viewerKey).map((entry): Face =>
    entry.participant.kind === "bot"
      ? { kind: "bot", name: entry.name, avatar: props.avatarOf(entry.participant.projectId) }
      : { kind: "person" },
  );
  return <GroupAvatar faces={faces} size={props.size} />;
}
