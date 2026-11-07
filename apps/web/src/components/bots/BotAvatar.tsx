import {
  AVATAR_ACCESSORY_MIN_SIZE,
  AVATAR_CANVAS,
  type AvatarShape,
  avatarEyeLine,
  avatarParts,
  avatarShapeKey,
  type BotAvatarFace,
  type BotAvatarStatus,
  type BotHatchStage,
  hatchShapes,
  workingDotsBox,
  workingDotsDataUrl,
} from "@t3tools/client-runtime/bot-avatar";
import type { ProjectAvatar } from "@t3tools/contracts";
import { lookFor } from "@t3tools/shared/botAvatar";
import { type Ref, useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";

import { watchPointer } from "./avatarGaze";

export interface BotAvatarProps {
  /** Null falls back to the look the name seeds. */
  readonly avatar: ProjectAvatar | null;
  readonly name: string;
  readonly status: BotAvatarStatus;
  /** Pixels square. Below 24 the accessory drops and a dot carries the status. */
  readonly size: number;
  /** While hatching, the stage replaces the status look. */
  readonly hatchStage?: BotHatchStage | undefined;
  readonly className?: string;
}

const STATUS_LABEL: Readonly<Record<BotAvatarStatus, string>> = {
  idle: "idle",
  working: "working",
  "needs-you": "needs you",
  dozing: "dozing",
};

/** Eyes follow the pointer and a click squints only where they're big enough to read. */
const LIVELY_MIN_SIZE = 32;
const HAPPY_MS = 700;

function Shape({ shape }: { readonly shape: AvatarShape }) {
  switch (shape.kind) {
    case "rect":
      return (
        <rect
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
      return <circle cx={shape.cx} cy={shape.cy} r={shape.r} fill={shape.fill} />;
    case "path":
      return (
        <path
          d={shape.d}
          fill={shape.fill ?? "none"}
          stroke={shape.stroke}
          strokeWidth={shape.strokeWidth}
          strokeLinecap={shape.linecap}
          strokeLinejoin="round"
          opacity={shape.opacity}
          transform={shape.transform}
        />
      );
  }
}

function Shapes({ shapes }: { readonly shapes: ReadonlyArray<AvatarShape> }) {
  return shapes.map((shape) => <Shape key={avatarShapeKey(shape)} shape={shape} />);
}

type Moment = { readonly status: BotAvatarStatus; readonly hatchStage: BotHatchStage | undefined };

function hop(unit: number): Keyframe[] {
  return [
    { transform: "translateY(0) scale(1, 1)" },
    { transform: "translateY(0) scale(1.08, 0.9)", offset: 0.15 },
    { transform: `translateY(${-2 * unit}px) scale(0.95, 1.06)`, offset: 0.4 },
    { transform: "translateY(0) scale(1.06, 0.94)", offset: 0.7 },
    { transform: "translateY(0) scale(1, 1)" },
  ];
}

function wobble(unit: number): Keyframe[] {
  return [
    { transform: "rotate(0)" },
    { transform: `rotate(${-3 * unit}deg)`, offset: 0.25 },
    { transform: `rotate(${3 * unit}deg)`, offset: 0.6 },
    { transform: "rotate(0)" },
  ];
}

const BLINK: Keyframe[] = [
  { transform: "scaleY(1)" },
  { transform: "scaleY(0.08)", offset: 0.45 },
  { transform: "scaleY(1)" },
];

const HOP_MS = 520;

/** The one-shot motion an event plays; nothing ever loops here. */
function transitionMotion(
  before: Moment,
  after: Moment,
  size: number,
): {
  readonly target: "body" | "eyes";
  readonly keyframes: Keyframe[];
  readonly ms: number;
} | null {
  if (after.hatchStage !== before.hatchStage && after.hatchStage !== undefined) {
    return after.hatchStage === "cap"
      ? { target: "body", keyframes: hop(size / 16), ms: HOP_MS }
      : { target: "body", keyframes: wobble(1), ms: 360 };
  }
  if (after.hatchStage !== undefined || after.status === before.status) return null;
  if (after.status === "needs-you") {
    return { target: "body", keyframes: hop(size / 16), ms: HOP_MS };
  }
  if (after.status === "idle") return { target: "eyes", keyframes: BLINK, ms: 190 };
  return null;
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function Figure({
  look,
  face,
  hatchStage,
  size,
  eyesRef,
}: {
  readonly look: ProjectAvatar;
  readonly face: BotAvatarFace;
  readonly hatchStage: BotHatchStage | undefined;
  readonly size: number;
  readonly eyesRef: Ref<SVGGElement>;
}) {
  const parts = hatchStage
    ? { body: hatchShapes(look, hatchStage, size), gaze: [], overlay: [] }
    : avatarParts(look, face, size);
  return (
    <svg
      aria-hidden
      className="block overflow-visible"
      width={size}
      height={size}
      viewBox={`0 0 ${AVATAR_CANVAS} ${AVATAR_CANVAS}`}
    >
      <Shapes shapes={parts.body} />
      <g
        ref={eyesRef}
        className="transition-[translate] duration-150 ease-out"
        style={{ transformBox: "view-box", transformOrigin: `0 ${avatarEyeLine(look)}px` }}
      >
        <Shapes shapes={parts.gaze} />
      </g>
      <Shapes shapes={parts.overlay} />
    </svg>
  );
}

export function BotAvatar({ avatar, name, status, size, hatchStage, className }: BotAvatarProps) {
  const look = lookFor(avatar, name);
  const hatching = hatchStage !== undefined;
  const working = !hatching && status === "working";
  const dot =
    !hatching &&
    size < AVATAR_ACCESSORY_MIN_SIZE &&
    (status === "needs-you" || status === "working");
  const lively = !hatching && size >= LIVELY_MIN_SIZE;
  const [happy, setHappy] = useState(false);
  const face: BotAvatarFace = happy && status === "idle" ? "happy" : status;
  const watching = lively && (face === "idle" || face === "needs-you");

  const bodyRef = useRef<HTMLSpanElement>(null);
  const eyesRef = useRef<SVGGElement>(null);
  const happyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const previous = useRef<Moment>({ status, hatchStage });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- plays a one-shot DOM animation when the status or hatch stage changes, never on mount
  useEffect(() => {
    const before = previous.current;
    previous.current = { status, hatchStage };
    if (reducedMotion()) return;
    const motion = transitionMotion(before, { status, hatchStage }, size);
    const target = motion?.target === "eyes" ? eyesRef.current : bodyRef.current;
    if (!motion || !target) return;
    const animation = target.animate(motion.keyframes, { duration: motion.ms });
    return () => animation.cancel();
  }, [status, hatchStage, size]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes the eyes to the window's pointer moves while they can look
  useEffect(() => {
    const eyes = eyesRef.current;
    if (!watching || !eyes || reducedMotion()) return;
    return watchPointer(eyes);
  }, [watching]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- clears a pending squint timer on unmount
  useEffect(() => () => clearTimeout(happyTimer.current), []);

  const squint = () => {
    if (!lively || status !== "idle" || reducedMotion()) return;
    setHappy(true);
    clearTimeout(happyTimer.current);
    happyTimer.current = setTimeout(() => setHappy(false), HAPPY_MS);
    bodyRef.current?.animate(hop(size / 16), { duration: HOP_MS });
  };

  return (
    <span
      role="img"
      aria-label={hatching ? `${name}, hatching` : `${name}, ${STATUS_LABEL[status]}`}
      data-status={hatching ? "hatching" : status}
      className={cn("relative inline-block shrink-0", className)}
      style={{ width: size, height: size }}
      onPointerDown={lively ? squint : undefined}
    >
      <span ref={bodyRef} className="absolute inset-0 origin-bottom">
        <Figure look={look} face={face} hatchStage={hatchStage} size={size} eyesRef={eyesRef} />
        {working ? (
          <img
            alt=""
            data-slot="bot-avatar-dots"
            src={workingDotsDataUrl()}
            className="absolute block"
            style={workingDotsBox(look, size)}
          />
        ) : null}
      </span>
      {dot ? (
        <span
          data-slot="bot-avatar-dot"
          // The cutout matches the surface behind; a surface other than background sets the token.
          className={cn(
            "-right-[3px] -bottom-[3px] absolute size-[7px] rounded-full outline-2 outline-bot-avatar-cutout",
            status === "needs-you" ? "bg-bot-needs-you" : "bg-bot-working",
          )}
        />
      ) : null}
    </span>
  );
}
