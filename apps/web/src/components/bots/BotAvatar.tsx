import {
  type BotAvatarStatus,
  type BotHatchStage,
  hatchShapes,
  VISOR_CANVAS,
  type VisorShape,
  visorParts,
  visorShapeKey,
  workingScanBox,
  workingScanDataUrl,
} from "@t3tools/client-runtime/bot-avatar";
import type { ProjectAvatar } from "@t3tools/contracts";
import { specFor } from "@t3tools/shared/botAvatar";
import { type Ref, useEffect, useRef } from "react";

import { cn } from "~/lib/utils";

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

const SMALL = 24;

function Shape({ shape }: { readonly shape: VisorShape }) {
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
        />
      );
  }
}

function Shapes({ shapes }: { readonly shapes: ReadonlyArray<VisorShape> }) {
  return shapes.map((shape) => <Shape key={visorShapeKey(shape)} shape={shape} />);
}

type Moment = { readonly status: BotAvatarStatus; readonly hatchStage: BotHatchStage | undefined };

function hop(unit: number): Keyframe[] {
  return [
    { transform: "translateY(0)" },
    { transform: `translateY(${-2 * unit}px)`, offset: 0.25 },
    { transform: "translateY(0)", offset: 0.55 },
    { transform: `translateY(${-unit}px)`, offset: 0.75 },
    { transform: "translateY(0)" },
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
  { transform: "scaleY(0.1)", offset: 0.4 },
  { transform: "scaleY(1)" },
];

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
      ? { target: "body", keyframes: hop(size / 16), ms: 480 }
      : { target: "body", keyframes: wobble(1), ms: 360 };
  }
  if (after.hatchStage !== undefined || after.status === before.status) return null;
  if (after.status === "needs-you") return { target: "body", keyframes: hop(size / 16), ms: 480 };
  if (after.status === "idle") return { target: "eyes", keyframes: BLINK, ms: 240 };
  return null;
}

function Visor({
  look,
  status,
  hatchStage,
  size,
  eyesRef,
}: {
  readonly look: ProjectAvatar;
  readonly status: BotAvatarStatus;
  readonly hatchStage: BotHatchStage | undefined;
  readonly size: number;
  readonly eyesRef: Ref<SVGGElement>;
}) {
  const parts = hatchStage
    ? { body: hatchShapes(look, hatchStage), eyes: [] }
    : visorParts(look, status, { includeAccessory: size >= SMALL });
  return (
    <svg
      aria-hidden
      className="block"
      width={size}
      height={size}
      viewBox={`0 0 ${VISOR_CANVAS} ${VISOR_CANVAS}`}
    >
      <Shapes shapes={parts.body} />
      <g ref={eyesRef} style={{ transformBox: "view-box", transformOrigin: "0 37px" }}>
        <Shapes shapes={parts.eyes} />
      </g>
    </svg>
  );
}

export function BotAvatar({ avatar, name, status, size, hatchStage, className }: BotAvatarProps) {
  const look = avatar ?? specFor(name);
  const hatching = hatchStage !== undefined;
  const working = !hatching && status === "working";
  const dot = !hatching && size < SMALL && (status === "needs-you" || status === "working");

  const bodyRef = useRef<HTMLSpanElement>(null);
  const eyesRef = useRef<SVGGElement>(null);
  const previous = useRef<Moment>({ status, hatchStage });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- plays a one-shot DOM animation when the status or hatch stage changes, never on mount
  useEffect(() => {
    const before = previous.current;
    previous.current = { status, hatchStage };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const motion = transitionMotion(before, { status, hatchStage }, size);
    const target = motion?.target === "eyes" ? eyesRef.current : bodyRef.current;
    if (!motion || !target) return;
    const animation = target.animate(motion.keyframes, { duration: motion.ms });
    return () => animation.cancel();
  }, [status, hatchStage, size]);

  return (
    <span
      role="img"
      aria-label={hatching ? `${name}, hatching` : `${name}, ${STATUS_LABEL[status]}`}
      data-status={hatching ? "hatching" : status}
      className={cn("relative inline-block shrink-0", className)}
      style={{ width: size, height: size }}
    >
      <span ref={bodyRef} className="absolute inset-0 origin-bottom">
        <Visor look={look} status={status} hatchStage={hatchStage} size={size} eyesRef={eyesRef} />
        {working ? (
          <img
            alt=""
            data-slot="bot-avatar-scan"
            src={workingScanDataUrl(look)}
            className="absolute block"
            style={workingScanBox(size)}
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
