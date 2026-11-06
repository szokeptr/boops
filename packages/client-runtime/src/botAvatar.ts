import type { BotAvatarShape, ProjectAvatar } from "@t3tools/contracts";
import * as Base64 from "effect/encoding/Base64";

/** A soft blob with big ink eyes, drawn as primitives on a 64×64 canvas. */
export const AVATAR_CANVAS = 64;

export type BotAvatarStatus = "idle" | "working" | "needs-you" | "dozing";
export type BotHatchStage = "egg" | "crack" | "cap";
/** What the face shows: a status, or the happy squint a click plays. */
export type BotAvatarFace = BotAvatarStatus | "happy";

export interface AvatarRect {
  readonly kind: "rect";
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly r: number;
  readonly fill: string;
  readonly opacity?: number;
}

export interface AvatarCircle {
  readonly kind: "circle";
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly fill: string;
}

export interface AvatarPath {
  readonly kind: "path";
  readonly d: string;
  readonly fill?: string;
  readonly stroke?: string;
  readonly strokeWidth?: number;
  readonly linecap?: "round";
  readonly opacity?: number;
  /** An SVG transform list; web and react-native-svg both take the string form. */
  readonly transform?: string;
}

/** Back to front; renderers map each 1:1 and give strokes round joins. */
export type AvatarShape = AvatarRect | AvatarCircle | AvatarPath;

/** A React key from geometry; no two shapes in one avatar share it. */
export function avatarShapeKey(shape: AvatarShape): string {
  if (shape.kind === "rect") return `r${shape.x},${shape.y}`;
  if (shape.kind === "circle") return `c${shape.cx},${shape.cy}`;
  return `p${shape.d}${shape.transform ?? ""}`;
}

type Rgb = readonly [number, number, number];

const HUE_DEGREES: Readonly<Record<ProjectAvatar["hue"], number>> = {
  tomato: 6,
  tangerine: 26,
  butter: 46,
  lime: 88,
  mint: 150,
  teal: 176,
  sky: 198,
  periwinkle: 226,
  lavender: 258,
  grape: 284,
  bubblegum: 320,
  rose: 344,
};

const GLOW: Readonly<Record<ProjectAvatar["glow"], string>> = {
  mint: "#86ffcf",
  cyan: "#8fe9ff",
  white: "#f2efff",
};
const INK = "#1b1726";
const AMBER = "#ffb321";
const AMBER_EDGE = "#e8951a";
const BOW = "#ff7a9a";
const SHELL = "#fbf3e2";
const SHELL_EDGE = "#c9b48f";

function hslToRgb(hue: number, saturation: number, lightness: number): Rgb {
  const h = (((hue % 360) + 360) % 360) / 360;
  const s = saturation / 100;
  const l = lightness / 100;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    const v =
      x < 1 / 6
        ? p + (q - p) * 6 * x
        : x < 1 / 2
          ? q
          : x < 2 / 3
            ? p + (q - p) * (2 / 3 - x) * 6
            : p;
    return Math.round(v * 255);
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
}

const hex = ([r, g, b]: Rgb) =>
  `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
const fromHex = (value: string): Rgb => [
  Number.parseInt(value.slice(1, 3), 16),
  Number.parseInt(value.slice(3, 5), 16),
  Number.parseInt(value.slice(5, 7), 16),
];
// Hex rather than CSS hsl(): react-native-svg and older RN colour parsers lack the space syntax.
const hsl = (h: number, s: number, l: number) => hex(hslToRgb(h, s, l));
const SPROUT_LIGHT = hsl(110, 48, 55);
const SPROUT_DARK = hsl(110, 48, 46);

export interface AvatarColors {
  readonly body: string;
  /** The belly crescent. */
  readonly shade: string;
  /** Accessory strokes. */
  readonly deep: string;
  readonly light: string;
  readonly blush: string;
  /** Tips of antennae and ears. */
  readonly glow: string;
}

export function avatarColors(avatar: ProjectAvatar): AvatarColors {
  const h = HUE_DEGREES[avatar.hue];
  return {
    body: hsl(h, 64, 67),
    shade: hsl(h, 48, 57),
    deep: hsl(h, 42, 44),
    light: hsl(h, 80, 84),
    blush: hsl(h - 10, 85, 62),
    glow: GLOW[avatar.glow],
  };
}

/** Your bubbles in a bot's DM wear its body colour, inked like its eyes so text reads in both themes. */
export function botBubbleColors(avatar: ProjectAvatar): {
  readonly background: string;
  readonly foreground: string;
} {
  return { background: avatarColors(avatar).body, foreground: INK };
}

interface Body {
  readonly d: string;
  /** Where the outline peaks; head accessories and the hatch cap sit on it. */
  readonly top: number;
  readonly eyeY: number;
  /** Each eye's distance from the centre line. */
  readonly eyeGap: number;
  /** Half the body's width at eye height, where headphone cups hang. */
  readonly halfWidth: number;
  readonly shine: string;
  /** The bow sits on the right shoulder, which pointy tops pull inward. */
  readonly bowX: number;
}

const BODIES: Readonly<Record<BotAvatarShape, Body>> = {
  gumdrop: {
    d: "M32 9C47 9 56 19 56 34C56 49 47 57 32 57S8 49 8 34C8 19 17 9 32 9Z",
    top: 9,
    eyeY: 33,
    eyeGap: 8.5,
    halfWidth: 24,
    shine: "M15.5 24Q19 14.5 29 13",
    bowX: 46,
  },
  round: {
    d: "M32 11A23 23 0 1 1 31.99 11Z",
    top: 11,
    eyeY: 34,
    eyeGap: 8.5,
    halfWidth: 23,
    shine: "M15 27Q18 17 28 14.5",
    bowX: 46,
  },
  box: {
    d: "M25 11H39C49 11 55 17 55 27V41C55 51 49 57 39 57H25C15 57 9 51 9 41V27C9 17 15 11 25 11Z",
    top: 11,
    eyeY: 33,
    eyeGap: 9,
    halfWidth: 23,
    shine: "M14 28Q14 17 25 15.5",
    bowX: 46,
  },
  onigiri: {
    d: "M32 10C36.5 10 39.5 12.5 42.5 17.5L54.5 40C59 49 53 57 44 57H20C11 57 5 49 9.5 40L21.5 17.5C24.5 12.5 27.5 10 32 10Z",
    top: 10,
    eyeY: 38,
    eyeGap: 7.5,
    halfWidth: 21,
    shine: "M20 28Q22.5 19.5 28 15.5",
    bowX: 41,
  },
  bean: {
    d: "M32 7C43 7 51 14 51 25V39C51 50 43 57 32 57S13 50 13 39V25C13 14 21 7 32 7Z",
    top: 7,
    eyeY: 30,
    eyeGap: 8,
    halfWidth: 19,
    shine: "M18 23Q18.5 13.5 27 11.5",
    bowX: 44,
  },
  mochi: {
    d: "M32 17C49 17 58 27 58 40C58 51 48 57 32 57S6 51 6 40C6 27 15 17 32 17Z",
    top: 17,
    eyeY: 38,
    eyeGap: 9.5,
    halfWidth: 26,
    shine: "M13 32Q17 22.5 27 20.5",
    bowX: 46,
  },
  ghost: {
    d: "M32 9C46 9 55 18 55 32V52C55 57.5 50 58.5 47.5 55C45.5 52 42 52 40 55C37.5 58.5 34.5 58.5 32 55C29.5 58.5 26.5 58.5 24 55C22 52 18.5 52 16.5 55C14 58.5 9 57.5 9 52V32C9 18 18 9 32 9Z",
    top: 9,
    eyeY: 31,
    eyeGap: 8.5,
    halfWidth: 23,
    shine: "M15 25Q17.5 15 27 13",
    bowX: 46,
  },
  drop: {
    d: "M32 7C38 15 56 23 56 38C56 50 46 57 32 57S8 50 8 38C8 23 26 15 32 7Z",
    top: 7,
    eyeY: 38,
    eyeGap: 8.5,
    halfWidth: 24,
    shine: "M16 34Q18 25 25 20",
    bowX: 39,
  },
};

const bodyOf = (avatar: ProjectAvatar) => BODIES[avatar.shape ?? "gumdrop"];

/** Where the eyes sit, so a renderer can pivot a blink on them. */
export function avatarEyeLine(avatar: ProjectAvatar): number {
  return bodyOf(avatar).eyeY;
}

/** Below this many pixels accessories turn to noise and drop. */
export const AVATAR_ACCESSORY_MIN_SIZE = 24;
/** Below this, highlights, blush, and badges drop and the eyes thicken to stay legible. */
const DETAIL_MIN_SIZE = 28;
const BELLY_SQUASH = 0.92;

const round2 = (n: number) => Math.round(n * 100) / 100;

function pill(cx: number, cy: number, w: number, h: number): string {
  const r = Math.min(w, h) / 2;
  return `M${round2(cx - w / 2)} ${round2(cy - h / 2 + r)}a${r} ${r} 0 0 1 ${w} 0v${round2(h - 2 * r)}a${r} ${r} 0 0 1 ${-w} 0z`;
}

function ellipse(cx: number, cy: number, rx: number, ry: number): string {
  return `M${round2(cx - rx)} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0z`;
}

function accessoryShapes(
  accessory: ProjectAvatar["accessory"],
  body: Body,
  c: AvatarColors,
): { readonly behind: ReadonlyArray<AvatarShape>; readonly front: ReadonlyArray<AvatarShape> } {
  const lift = body.top - 9;
  const stroke = (d: string, strokeWidth = 2.6): AvatarPath => ({
    kind: "path",
    d,
    stroke: c.deep,
    strokeWidth,
    linecap: "round",
    ...(lift === 0 ? {} : { transform: `translate(0 ${lift})` }),
  });
  const at = (y: number) => y + lift;
  switch (accessory) {
    case "none":
      return { behind: [], front: [] };
    case "antenna":
      return {
        behind: [stroke("M32 10V4"), { kind: "circle", cx: 32, cy: at(4), r: 3.2, fill: c.glow }],
        front: [],
      };
    case "rabbit":
      return {
        behind: [
          stroke("M25 11.5L21 3"),
          stroke("M39 11.5L43 3"),
          { kind: "circle", cx: 21, cy: at(3), r: 2.4, fill: c.glow },
          { kind: "circle", cx: 43, cy: at(3), r: 2.4, fill: c.glow },
        ],
        front: [],
      };
    case "handle":
      return { behind: [stroke("M21 14q11-16 22 0", 3.2)], front: [] };
    case "sprout":
      return {
        behind: [
          stroke("M32 10V5", 2.4),
          {
            kind: "path",
            d: `M32 ${at(6)}c0-5 3-7 8-7c0 4-3 7-8 7z`,
            fill: SPROUT_LIGHT,
          },
          {
            kind: "path",
            d: `M32 ${at(7)}c0-4-3-6-7-6c0 3 3 6 7 6z`,
            fill: SPROUT_DARK,
          },
        ],
        front: [],
      };
    case "bow": {
      const x = body.bowX;
      const y = body.top + 4;
      return {
        behind: [],
        front: [
          { kind: "path", d: `M${x - 3} ${y - 4}l-6 4 6 4zM${x + 3} ${y - 4}l6 4-6 4z`, fill: BOW },
          { kind: "circle", cx: x, cy: y, r: 2.5, fill: BOW },
        ],
      };
    }
    case "crown":
      return {
        behind: [
          {
            kind: "path",
            d: `M22 ${at(13)}l1.6-8.5 4.8 4.5 3.6-6.5 3.6 6.5 4.8-4.5L42 ${at(13)}z`,
            fill: AMBER,
            stroke: AMBER_EDGE,
            strokeWidth: 1,
          },
        ],
        front: [],
      };
    case "phones": {
      const left = 32 - body.halfWidth;
      const right = 32 + body.halfWidth;
      const cupTop = body.eyeY - 7.5;
      // A cubic's apex sits 3/4 of the way to its control points; aim it just above the head.
      const control = round2(cupTop + (body.top - 3 - cupTop) / 0.75);
      return {
        behind: [],
        front: [
          {
            kind: "path",
            d: `M${left} ${cupTop}C${left} ${control} ${right} ${control} ${right} ${cupTop}`,
            stroke: c.deep,
            strokeWidth: 2.6,
            linecap: "round",
          },
          { kind: "rect", x: left - 3.5, y: cupTop, w: 7, h: 15, r: 3.5, fill: c.deep },
          { kind: "rect", x: right - 3.5, y: cupTop, w: 7, h: 15, r: 3.5, fill: c.deep },
        ],
      };
    }
  }
}

const EYE_W = 8.6;
const EYE_H = 13.5;

function eye(cx: number, cy: number, wide: boolean, detail: boolean): ReadonlyArray<AvatarShape> {
  const w = round2(EYE_W + (wide ? 1 : 0) + (detail ? 0 : 1.6));
  const h = EYE_H + (wide ? 2 : 0) + (detail ? 0 : 1.5);
  const ink: AvatarPath = { kind: "path", d: pill(cx, cy, w, h), fill: INK };
  if (!detail) return [ink];
  return [
    ink,
    {
      kind: "circle",
      cx: round2(cx + 1.5),
      cy: round2(cy - h / 2 + 3.4),
      r: wide ? 2.1 : 1.7,
      fill: "#ffffff",
    },
  ];
}

function lidArc(cx: number, cy: number, up: boolean, detail: boolean): AvatarPath {
  return {
    kind: "path",
    d: `M${round2(cx - 4.8)} ${cy + (up ? 2 : -1)}q4.8 ${up ? -7 : 5} 9.6 0`,
    stroke: INK,
    strokeWidth: detail ? 3.4 : 4.4,
    linecap: "round",
  };
}

interface FaceParts {
  readonly cheeks: number;
  /** Eyes and brows: what follows the pointer and blinks. */
  readonly gaze: ReadonlyArray<AvatarShape>;
  readonly still: ReadonlyArray<AvatarShape>;
  readonly overlay: ReadonlyArray<AvatarShape>;
}

function faceParts(face: BotAvatarFace, body: Body, c: AvatarColors, detail: boolean): FaceParts {
  const y = body.eyeY;
  const left = 32 - body.eyeGap;
  const right = 32 + body.eyeGap;
  switch (face) {
    case "idle":
      return {
        cheeks: 0.42,
        gaze: [...eye(left, y, false, detail), ...eye(right, y, false, detail)],
        still: [],
        overlay: [],
      };
    case "happy":
      return {
        cheeks: 0.7,
        gaze: [lidArc(left, y, true, detail), lidArc(right, y, true, detail)],
        still: [],
        overlay: [],
      };
    case "working":
      // The bouncing dots ship as an APNG laid over the face; see workingDotsBox.
      return { cheeks: 0.3, gaze: [], still: [], overlay: [] };
    case "dozing":
      return {
        cheeks: 0.25,
        gaze: [],
        still: [lidArc(left, y, false, detail), lidArc(right, y, false, detail)],
        overlay: detail
          ? [
              {
                kind: "path",
                d: `M46 ${Math.max(6, y - 21)}h7l-7 7h7`,
                stroke: c.deep,
                strokeWidth: 2.2,
                linecap: "round",
                opacity: 0.8,
              },
            ]
          : [],
      };
    case "needs-you": {
      const badgeY = Math.max(9, y - 18);
      return {
        cheeks: 0.5,
        gaze: [
          ...eye(left, y, true, detail),
          ...eye(right, y, true, detail),
          {
            kind: "path",
            d: `M${left - 4} ${y - 11.5}q4-2.6 8-.6M${right - 4} ${y - 12.1}q4-2 8 .6`,
            stroke: INK,
            strokeWidth: 2,
            linecap: "round",
          },
        ],
        still: [],
        overlay: detail
          ? [
              { kind: "circle", cx: 13, cy: badgeY, r: 6.2, fill: AMBER },
              {
                kind: "path",
                d: `M13 ${badgeY - 3.2}v3.6`,
                stroke: INK,
                strokeWidth: 2.2,
                linecap: "round",
              },
              { kind: "circle", cx: 13, cy: badgeY + 3.4, r: 1.2, fill: INK },
            ]
          : [],
      };
    }
  }
}

export interface AvatarParts {
  readonly body: ReadonlyArray<AvatarShape>;
  /** Drawn in their own group so a renderer can move them toward the pointer or blink them. */
  readonly gaze: ReadonlyArray<AvatarShape>;
  readonly overlay: ReadonlyArray<AvatarShape>;
}

/** The avatar split so a renderer can animate the eyes alone. `size` is in pixels. */
export function avatarParts(
  avatar: ProjectAvatar,
  face: BotAvatarFace = "idle",
  size = AVATAR_CANVAS,
): AvatarParts {
  const c = avatarColors(avatar);
  const body = bodyOf(avatar);
  const detail = size >= DETAIL_MIN_SIZE;
  const accessory =
    size >= AVATAR_ACCESSORY_MIN_SIZE
      ? accessoryShapes(avatar.accessory, body, c)
      : { behind: [], front: [] };
  const parts = faceParts(face, body, c, detail);
  const cheeks: ReadonlyArray<AvatarShape> = detail
    ? [-1, 1].map((side) => ({
        kind: "path",
        d: ellipse(32 + side * (body.eyeGap + 8), body.eyeY + 10, 4.2, 2.5),
        fill: c.blush,
        opacity: parts.cheeks,
      }))
    : [];
  return {
    body: [
      ...accessory.behind,
      { kind: "path", d: body.d, fill: c.shade },
      // The outline again, squashed up from its top, so a shade crescent shows below on any shape.
      {
        kind: "path",
        d: body.d,
        fill: c.body,
        transform: `matrix(1 0 0 ${BELLY_SQUASH} 0 ${round2(body.top * (1 - BELLY_SQUASH))})`,
      },
      ...(detail
        ? [
            {
              kind: "path",
              d: body.shine,
              stroke: c.light,
              strokeWidth: 2.8,
              linecap: "round",
              opacity: 0.9,
            } satisfies AvatarPath,
          ]
        : []),
      ...accessory.front,
      ...cheeks,
      ...parts.still,
    ],
    gaze: parts.gaze,
    overlay: parts.overlay,
  };
}

export function avatarShapes(
  avatar: ProjectAvatar,
  face: BotAvatarFace = "idle",
  size = AVATAR_CANVAS,
): ReadonlyArray<AvatarShape> {
  const { body, gaze, overlay } = avatarParts(avatar, face, size);
  return [...body, ...gaze, ...overlay];
}

const EGG = "M32 6C45 6 54 24 54 38C54 51 44 59 32 59S10 51 10 38C10 24 19 6 32 6Z";
const CRACK = "M12 30l5 4 4-5 5 4 6-5 6 5 5-4 4 5 5-4";

/** Egg, then the bot peeking through a crack, then the bot wearing the shell top as a cap. */
export function hatchShapes(
  avatar: ProjectAvatar,
  stage: BotHatchStage,
  size = AVATAR_CANVAS,
): ReadonlyArray<AvatarShape> {
  const c = avatarColors(avatar);
  if (stage === "cap") {
    return [
      ...avatarShapes({ ...avatar, accessory: "none" }, "idle", size),
      {
        kind: "path",
        d: "M13 17C15 7 22 2 32 2S49 7 51 17l-5-3-4 4-5-4-5 4-5-4-4 4-4-4z",
        fill: SHELL,
        stroke: SHELL_EDGE,
        strokeWidth: 2,
        transform: `translate(0 ${bodyOf(avatar).top - 9}) rotate(-8 32 12)`,
      },
    ];
  }
  const egg: AvatarPath = {
    kind: "path",
    d: EGG,
    fill: SHELL,
    stroke: SHELL_EDGE,
    strokeWidth: 2,
  };
  const speck = (cx: number, cy: number, r: number): AvatarCircle => ({
    kind: "circle",
    cx,
    cy,
    r,
    fill: c.body,
  });
  if (stage === "egg") return [egg, speck(24, 24, 2.4), speck(40, 33, 3), speck(27, 46, 2)];
  const detail = size >= DETAIL_MIN_SIZE;
  return [
    egg,
    // Below the crack the shell has fallen away, showing the bot inside the egg's outline.
    {
      kind: "path",
      d: `${CRACK}L53.4 33C53.8 35 54 36.5 54 38C54 51 44 59 32 59S10 51 10 38C10 35.5 10.7 32.7 12 30Z`,
      fill: c.body,
    },
    { kind: "path", d: EGG, stroke: SHELL_EDGE, strokeWidth: 2 },
    ...eye(23.5, 40, false, detail),
    ...eye(40.5, 40, false, detail),
    { kind: "path", d: CRACK, stroke: SHELL_EDGE, strokeWidth: 2, linecap: "round" },
  ];
}

/**
 * The working face: three ink dots bouncing in turn. They ship as an APNG with a clear
 * background laid over the face, so the only endless loop costs the main thread nothing;
 * CSS keyframes and JS timers measured far worse.
 */
export const WORKING_DOTS = {
  /** Relative to the eye line: the overlay spans x 17-47 and from 10 above the eyes to 5 below. */
  width: 30,
  height: 15,
  above: 10,
  left: 17,
  gap: 9.5,
  radius: 4,
  bounce: 3.5,
  frames: 12,
  frameMs: 90,
  /** Raster pixels per canvas unit, so the overlay stays sharp up to 4× the 64-unit grid. */
  scale: 4,
} as const;

const coverage = (distance: number, scale: number) =>
  Math.max(0, Math.min(1, 0.5 - distance * scale));

/** Each dot rises and brightens over the first 60% of its cycle, a third of that behind the last. */
function dotLift(t: number): number {
  const phase = ((t % 1) + 1) % 1;
  return phase < 0.6 ? Math.sin((Math.PI * phase) / 0.6) : 0;
}

function dotsFrame(t: number): Uint8Array {
  const { width, height, scale, above, gap, radius, bounce } = WORKING_DOTS;
  const w = width * scale;
  const h = height * scale;
  const ink = fromHex(INK);
  const dots = [-1, 0, 1].map((slot, i) => {
    const lift = dotLift(t - i * 0.15);
    return { cx: width / 2 + slot * gap, cy: above - lift * bounce, alpha: 0.4 + 0.6 * lift };
  });
  const pixels = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = (x + 0.5) / scale;
      const py = (y + 0.5) / scale;
      let alpha = 0;
      for (const dot of dots) {
        const cover = coverage(Math.hypot(px - dot.cx, py - dot.cy) - radius, scale);
        alpha = Math.max(alpha, cover * dot.alpha);
      }
      const at = (y * w + x) * 4;
      pixels[at] = ink[0];
      pixels[at + 1] = ink[1];
      pixels[at + 2] = ink[2];
      pixels[at + 3] = Math.round(alpha * 255);
    }
  }
  return pixels;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: ArrayLike<number>): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n: number) => [(n >>> 8) & 255, n & 255];

function chunk(type: string, data: ArrayLike<number>): number[] {
  const typed = [...type].map((c) => c.charCodeAt(0)).concat(Array.from(data));
  return [...u32(data.length), ...typed, ...u32(crc32(typed))];
}

const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
  163, 195, 227, 258,
];
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DISTANCE_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049,
  3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DISTANCE_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];

const bucket = (bases: ReadonlyArray<number>, value: number) => {
  let i = bases.length - 1;
  while (bases[i]! > value) i--;
  return i;
};

/**
 * Fixed-Huffman deflate that only looks back one pixel or one scanline. Flat-colour frames
 * shrink ~50×, which a stored block (and a 64 KiB cap) would not.
 */
function deflate(raw: Uint8Array, lookbacks: ReadonlyArray<number>): number[] {
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  const write = (value: number, count: number) => {
    acc |= value << bits;
    bits += count;
    while (bits >= 8) {
      out.push(acc & 255);
      acc >>>= 8;
      bits -= 8;
    }
  };
  const code = (value: number, count: number) => {
    let reversed = 0;
    for (let i = 0; i < count; i++) reversed = (reversed << 1) | ((value >>> i) & 1);
    write(reversed, count);
  };
  const literal = (v: number) => {
    if (v < 144) code(0x30 + v, 8);
    else if (v < 256) code(0x190 + v - 144, 9);
    else if (v < 280) code(v - 256, 7);
    else code(0xc0 + v - 280, 8);
  };
  write(1, 1);
  write(1, 2);
  let i = 0;
  while (i < raw.length) {
    let bestLength = 0;
    let bestDistance = 0;
    for (const distance of lookbacks) {
      if (distance > i) continue;
      let length = 0;
      while (
        length < 258 &&
        i + length < raw.length &&
        raw[i + length] === raw[i + length - distance]
      ) {
        length++;
      }
      if (length > bestLength) {
        bestLength = length;
        bestDistance = distance;
      }
    }
    if (bestLength < 3) {
      literal(raw[i]!);
      i++;
      continue;
    }
    const l = bucket(LENGTH_BASE, bestLength);
    literal(257 + l);
    write(bestLength - LENGTH_BASE[l]!, LENGTH_EXTRA[l]!);
    const d = bucket(DISTANCE_BASE, bestDistance);
    code(d, 5);
    write(bestDistance - DISTANCE_BASE[d]!, DISTANCE_EXTRA[d]!);
    i += bestLength;
  }
  literal(256);
  if (bits > 0) out.push(acc & 255);
  return out;
}

function zlib(raw: Uint8Array, lookbacks: ReadonlyArray<number>): number[] {
  let a = 1;
  let b = 0;
  for (const byte of raw) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return [0x78, 0x01, ...deflate(raw, lookbacks), ...u32(((b << 16) | a) >>> 0)];
}

/** A looping RGBA APNG. Frames are `width * height * 4` bytes each. */
function encodeApng(
  width: number,
  height: number,
  frames: ReadonlyArray<Uint8Array>,
  frameDelayMs: number,
): Uint8Array {
  const bytes = [137, 80, 78, 71, 13, 10, 26, 10];
  bytes.push(...chunk("IHDR", [...u32(width), ...u32(height), 8, 6, 0, 0, 0]));
  bytes.push(...chunk("acTL", [...u32(frames.length), ...u32(0)]));
  const stride = width * 4 + 1;
  let sequence = 0;
  frames.forEach((frame, i) => {
    bytes.push(
      ...chunk("fcTL", [
        ...u32(sequence++),
        ...u32(width),
        ...u32(height),
        ...u32(0),
        ...u32(0),
        ...u16(frameDelayMs),
        ...u16(1000),
        0,
        0,
      ]),
    );
    const scanlines = new Uint8Array(stride * height);
    for (let y = 0; y < height; y++) {
      scanlines.set(frame.subarray(y * width * 4, (y + 1) * width * 4), y * stride + 1);
    }
    const data = zlib(scanlines, [4, stride]);
    bytes.push(...(i === 0 ? chunk("IDAT", data) : chunk("fdAT", [...u32(sequence++), ...data])));
  });
  bytes.push(...chunk("IEND", []));
  return new Uint8Array(bytes);
}

/** The working loop: WORKING_DOTS.frames frames of the dots taking turns. */
export function workingDotsApng(): Uint8Array {
  const { width, height, scale, frames, frameMs } = WORKING_DOTS;
  return encodeApng(
    width * scale,
    height * scale,
    Array.from({ length: frames }, (_, i) => dotsFrame(i / frames)),
    frameMs,
  );
}

let dotsUrl: string | undefined;

/** One `data:` URL for every bot: the dots are ink on clear, whatever the body colour. */
export function workingDotsDataUrl(): string {
  dotsUrl ??= `data:image/png;base64,${Base64.encode(workingDotsApng())}`;
  return dotsUrl;
}

/** Where the dots overlay sits for an avatar drawn `size` pixels square. */
export function workingDotsBox(
  avatar: ProjectAvatar,
  size: number,
): {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
} {
  const unit = size / AVATAR_CANVAS;
  const { left, above, width, height } = WORKING_DOTS;
  return {
    left: left * unit,
    top: (bodyOf(avatar).eyeY - above) * unit,
    width: width * unit,
    height: height * unit,
  };
}
