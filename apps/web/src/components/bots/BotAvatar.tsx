import {
  type BotAvatarStatus,
  type BotHatchStage,
  BUBBLE_HEIGHT,
  BUBBLE_WIDTH,
  blinkLids,
  bubbleGrid,
  hatchGrid,
  SPRITE_SIZE,
  type SpriteGrid,
  screenieGrid,
  screeniePalette,
  spriteRects,
  WORKING_DASHES,
  workingDashesDataUrl,
} from "@t3tools/client-runtime/bot-avatar";
import type { ProjectAvatar } from "@t3tools/contracts";
import { specFor } from "@t3tools/shared/botAvatar";
import { type CSSProperties, type Ref, useEffect, useRef } from "react";

import { cn } from "~/lib/utils";

/** Pixel art stays even only at whole multiples of the 16-cell sprite. */
export type BotAvatarSize = 16 | 32 | 48 | 64;

export interface BotAvatarProps {
  /** Null falls back to the look the name seeds. */
  readonly avatar: ProjectAvatar | null;
  readonly name: string;
  readonly status: BotAvatarStatus;
  readonly size: BotAvatarSize;
  /** While hatching, the stage replaces the status sprite. */
  readonly hatchStage?: BotHatchStage | undefined;
  readonly className?: string;
}

const STATUS_LABEL: Readonly<Record<BotAvatarStatus, string>> = {
  idle: "idle",
  working: "working",
  "needs-you": "needs you",
  dozing: "dozing",
};

const BUBBLE_PALETTE = { o: "#25223a", W: "#ffffff", k: "#25223a", Y: "#ffc23d" } as const;
const DOZING_BUBBLE_PALETTE = { k: "currentColor" } as const;

function Sprite({
  ref,
  ...props
}: {
  readonly grid: SpriteGrid;
  readonly palette: Parameters<typeof spriteRects>[1];
  readonly width: number;
  readonly height: number;
  readonly slot?: string;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly ref?: Ref<SVGSVGElement>;
}) {
  const rects = spriteRects(props.grid, props.palette);
  const cells = props.grid[0]!.length;
  return (
    <svg
      ref={ref}
      aria-hidden
      data-slot={props.slot}
      className={props.className}
      style={props.style}
      width={props.width}
      height={props.height}
      viewBox={`0 0 ${cells} ${props.grid.length}`}
      shapeRendering="crispEdges"
    >
      {rects.map((rect) => (
        <rect
          key={`${rect.x}:${rect.y}`}
          x={rect.x}
          y={rect.y}
          width={rect.width}
          height={1}
          fill={rect.fill}
        />
      ))}
    </svg>
  );
}

type Moment = { readonly status: BotAvatarStatus; readonly hatchStage: BotHatchStage | undefined };

// Discrete steps keep every frame on the pixel grid.
const STEP = { easing: "steps(1, end)" } as const;

function hop(unit: number): Keyframe[] {
  return [
    { transform: "translateY(0)", ...STEP },
    { transform: `translateY(${-2 * unit}px)`, offset: 0.2, ...STEP },
    { transform: `translateY(${-unit}px)`, offset: 0.45, ...STEP },
    { transform: "translateY(0)", offset: 0.6, ...STEP },
    { transform: `translateY(${-unit}px)`, offset: 0.75, ...STEP },
    { transform: "translateY(0)" },
  ];
}

function wobble(unit: number): Keyframe[] {
  return [
    { transform: "translateX(0)", ...STEP },
    { transform: `translateX(${-unit}px)`, offset: 0.2, ...STEP },
    { transform: `translateX(${unit}px)`, offset: 0.4, ...STEP },
    { transform: `translateX(${-unit}px)`, offset: 0.6, ...STEP },
    { transform: "translateX(0)" },
  ];
}

const BLINK: Keyframe[] = [
  { opacity: 0, ...STEP },
  { opacity: 1, offset: 0.3, ...STEP },
  { opacity: 0, offset: 0.7 },
];

/** The one-shot motion an event plays; nothing ever loops here. */
function transitionMotion(
  before: Moment,
  after: Moment,
  unit: number,
): {
  readonly target: "body" | "lids";
  readonly keyframes: Keyframe[];
  readonly ms: number;
} | null {
  if (after.hatchStage !== before.hatchStage && after.hatchStage !== undefined) {
    return after.hatchStage === "cap"
      ? { target: "body", keyframes: hop(unit), ms: 480 }
      : { target: "body", keyframes: wobble(unit), ms: 360 };
  }
  if (after.hatchStage !== undefined || after.status === before.status) return null;
  if (after.status === "needs-you") return { target: "body", keyframes: hop(unit), ms: 480 };
  if (after.status === "idle") return { target: "lids", keyframes: BLINK, ms: 360 };
  return null;
}

export function BotAvatar({ avatar, name, status, size, hatchStage, className }: BotAvatarProps) {
  const look = avatar ?? specFor(name);
  const palette = screeniePalette(look);
  const grid = hatchStage ? hatchGrid(look, hatchStage) : screenieGrid(look, status);
  const unit = size / SPRITE_SIZE;
  const hatching = hatchStage !== undefined;
  const working = !hatching && status === "working";
  const bubble = !hatching && size >= 32 && (status === "needs-you" || status === "dozing");
  const dot = !hatching && size < 32 && (status === "needs-you" || status === "working");
  const bubbleScale = size >= 48 ? 2 : 1;

  const bodyRef = useRef<HTMLSpanElement>(null);
  const lidsRef = useRef<SVGSVGElement>(null);
  const previous = useRef<Moment>({ status, hatchStage });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- plays a one-shot DOM animation when the status or hatch stage changes, never on mount
  useEffect(() => {
    const before = previous.current;
    previous.current = { status, hatchStage };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const motion = transitionMotion(before, { status, hatchStage }, unit);
    const target = motion?.target === "lids" ? lidsRef.current : bodyRef.current;
    if (!motion || !target) return;
    const animation = target.animate(motion.keyframes, { duration: motion.ms });
    return () => animation.cancel();
  }, [status, hatchStage, unit]);

  return (
    <span
      role="img"
      aria-label={hatching ? `${name}, hatching` : `${name}, ${STATUS_LABEL[status]}`}
      data-status={hatching ? "hatching" : status}
      className={cn("relative inline-block shrink-0", className)}
      style={{ width: size, height: size }}
    >
      <span ref={bodyRef} className="absolute inset-0">
        <Sprite grid={grid} palette={palette} width={size} height={size} className="block" />
        {!hatching && status === "idle" ? (
          <Sprite
            ref={lidsRef}
            grid={blinkLids(look)}
            palette={palette}
            width={size}
            height={size}
            className="absolute inset-0 opacity-0"
          />
        ) : null}
        {working ? (
          <img
            alt=""
            data-slot="bot-avatar-dashes"
            src={workingDashesDataUrl(look)}
            className="absolute block [image-rendering:pixelated]"
            style={{
              left: WORKING_DASHES.col * unit,
              top: WORKING_DASHES.row * unit,
              width: WORKING_DASHES.width * unit,
              height: WORKING_DASHES.height * unit,
            }}
          />
        ) : null}
      </span>
      {bubble ? (
        <Sprite
          slot="bot-avatar-bubble"
          grid={bubbleGrid(status === "dozing" ? "dozing" : "needs-you")}
          palette={status === "dozing" ? DOZING_BUBBLE_PALETTE : BUBBLE_PALETTE}
          width={BUBBLE_WIDTH * bubbleScale}
          height={BUBBLE_HEIGHT * bubbleScale}
          className="absolute text-muted-foreground"
          style={{ right: -5 * bubbleScale, top: -4 * bubbleScale }}
        />
      ) : null}
      {dot ? (
        <span
          data-slot="bot-avatar-dot"
          // The cutout matches the surface behind; a surface other than background sets the token.
          className={cn(
            "-right-[3px] -bottom-[3px] absolute size-[7px] outline-2 outline-bot-avatar-cutout",
            status === "needs-you" ? "bg-bot-needs-you" : "bg-bot-working",
          )}
        />
      ) : null}
    </span>
  );
}
