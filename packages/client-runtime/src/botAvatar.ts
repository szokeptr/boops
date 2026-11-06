import type { ProjectAvatar } from "@t3tools/contracts";
import * as Base64 from "effect/encoding/Base64";

/** Visor: a rounded bot with a dark visor, drawn as primitives on a 64×64 canvas. */
export const VISOR_CANVAS = 64;

export type BotAvatarStatus = "idle" | "working" | "needs-you" | "dozing";
export type BotHatchStage = "egg" | "crack" | "cap";

export interface VisorRect {
  readonly kind: "rect";
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly r: number;
  readonly fill: string;
  readonly opacity?: number;
}

export interface VisorCircle {
  readonly kind: "circle";
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly fill: string;
}

export interface VisorPath {
  readonly kind: "path";
  readonly d: string;
  readonly fill?: string;
  readonly stroke?: string;
  readonly strokeWidth?: number;
  readonly linecap?: "round";
  readonly opacity?: number;
}

/** Back to front; renderers map each 1:1 and give strokes round joins. */
export type VisorShape = VisorRect | VisorCircle | VisorPath;

/** A React key from geometry; no two shapes in one avatar share it. */
export function visorShapeKey(shape: VisorShape): string {
  if (shape.kind === "rect") return `r${shape.x},${shape.y}`;
  if (shape.kind === "circle") return `c${shape.cx},${shape.cy}`;
  return `p${shape.d}`;
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
const VISOR = "#1d1a2a";
const AMBER = "#ffc23d";
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
const SPROUT_LIGHT = hsl(110, 45, 55);
const SPROUT_DARK = hsl(110, 45, 48);

export interface VisorColors {
  readonly body: string;
  readonly shade: string;
  readonly light: string;
  readonly glow: string;
}

export function visorColors(avatar: ProjectAvatar): VisorColors {
  const h = HUE_DEGREES[avatar.hue];
  return {
    body: hsl(h, 62, 66),
    shade: hsl(h, 40, 46),
    light: hsl(h, 70, 82),
    glow: GLOW[avatar.glow],
  };
}

/** Your bubbles in a bot's DM wear its body colour, inked like its visor so text reads in both themes. */
export function botBubbleColors(avatar: ProjectAvatar): {
  readonly background: string;
  readonly foreground: string;
} {
  return { background: visorColors(avatar).body, foreground: VISOR };
}

const BODY = { x: 10, y: 12, w: 44, h: 44, r: 16 } as const;
const VIS = { x: 13, y: 26, w: 38, h: 22 } as const;
const EYE_CY = VIS.y + VIS.h / 2;
const EYE_L = 25;
const EYE_R = 39;
const GLINT = { x0: 18, y0: VIS.y + 4, cx: 22, cy: VIS.y + 1.5, x1: 27, y1: VIS.y + 1.5 } as const;

function pill(
  cx: number,
  cy: number,
  w: number,
  h: number,
  fill: string,
  opacity?: number,
): VisorRect {
  return {
    kind: "rect",
    x: cx - w / 2,
    y: cy - h / 2,
    w,
    h,
    r: Math.min(w, h) / 2,
    fill,
    ...(opacity === undefined ? {} : { opacity }),
  };
}

/** The eyes carry the status: amber needs you, pills work, dim lines doze. */
function eyeShapes(status: BotAvatarStatus, glow: string, offsetX = 0): ReadonlyArray<VisorRect> {
  const L = EYE_L + offsetX;
  const R = EYE_R + offsetX;
  switch (status) {
    case "working":
      return [pill(L - 1, EYE_CY, 9, 4, glow), pill(R - 1, EYE_CY, 9, 4, glow)];
    case "needs-you":
      return [pill(L, EYE_CY, 6.5, 12, AMBER), pill(R, EYE_CY, 6.5, 12, AMBER)];
    case "dozing":
      return [pill(L, EYE_CY, 8, 2, glow, 0.45), pill(R, EYE_CY, 8, 2, glow, 0.45)];
    case "idle":
      return [pill(L, EYE_CY, 6, 10, glow), pill(R, EYE_CY, 6, 10, glow)];
  }
}

function accessoryShapes(
  accessory: ProjectAvatar["accessory"],
  c: VisorColors,
): ReadonlyArray<VisorShape> {
  const stroke = (d: string, strokeWidth = 2.8): VisorPath => ({
    kind: "path",
    d,
    stroke: c.shade,
    strokeWidth,
    linecap: "round",
  });
  switch (accessory) {
    case "none":
      return [];
    case "antenna":
      return [stroke("M32 12V5", 2.6), { kind: "circle", cx: 32, cy: 5, r: 3.2, fill: c.glow }];
    case "rabbit":
      return [
        stroke("M24 13L20 3", 2.6),
        stroke("M40 13L44 3", 2.6),
        { kind: "circle", cx: 20, cy: 3.5, r: 2.4, fill: c.glow },
        { kind: "circle", cx: 44, cy: 3.5, r: 2.4, fill: c.glow },
      ];
    case "handle":
      return [stroke("M21 13q11-9 22 0", 3)];
    case "sprout":
      return [
        stroke("M32 13V7", 2.4),
        { kind: "path", d: "M32 8c0-5 3-7 8-7c0 4-3 7-8 7z", fill: SPROUT_LIGHT },
        { kind: "path", d: "M32 9c0-4-3-6-7-6c0 3 3 6 7 6z", fill: SPROUT_DARK },
      ];
    case "bow":
      return [
        { kind: "path", d: "M44 9l-7 4 7 4zM50 9l7 4-7 4z", fill: "#ff7a9a" },
        { kind: "circle", cx: 47, cy: 13, r: 2.6, fill: "#ff7a9a" },
      ];
    case "phones":
      return [
        { kind: "rect", x: 5, y: 30, w: 6, h: 14, r: 3, fill: c.shade },
        { kind: "rect", x: 53, y: 30, w: 6, h: 14, r: 3, fill: c.shade },
        stroke("M8 30q0-24 24-24t24 24", 2.4),
      ];
    case "crown":
      return [{ kind: "path", d: "M21 14l2-9 5 5 4-7 4 7 5-5 2 9z", fill: AMBER }];
  }
}

export interface VisorOptions {
  /** Below 24px accessories turn to noise; lists pass false. */
  readonly includeAccessory?: boolean;
}

/** The avatar split so a renderer can animate the eyes alone (a one-shot blink). */
export function visorParts(
  avatar: ProjectAvatar,
  status: BotAvatarStatus = "idle",
  { includeAccessory = true }: VisorOptions = {},
): { readonly body: ReadonlyArray<VisorShape>; readonly eyes: ReadonlyArray<VisorRect> } {
  const c = visorColors(avatar);
  return {
    body: [
      ...(includeAccessory ? accessoryShapes(avatar.accessory, c) : []),
      { kind: "rect", ...BODY, fill: c.body },
      { kind: "rect", ...VIS, r: VIS.h / 2, fill: VISOR },
      {
        kind: "path",
        d: `M${GLINT.x0} ${GLINT.y0}q4-2.5 9-2.5`,
        stroke: "#ffffff",
        strokeWidth: 1.6,
        linecap: "round",
        opacity: 0.35,
      },
    ],
    eyes: eyeShapes(status, c.glow),
  };
}

export function visorShapes(
  avatar: ProjectAvatar,
  status: BotAvatarStatus = "idle",
  options: VisorOptions = {},
): ReadonlyArray<VisorShape> {
  const { body, eyes } = visorParts(avatar, status, options);
  return [...body, ...eyes];
}

/** Egg, then the visor peeking through a crack, then the bot wearing the shell top as a cap. */
export function hatchShapes(
  avatar: ProjectAvatar,
  stage: BotHatchStage,
): ReadonlyArray<VisorShape> {
  const c = visorColors(avatar);
  if (stage === "cap") {
    return [
      ...visorShapes(avatar, "idle", { includeAccessory: false }),
      {
        kind: "path",
        d: "M14 18C16 8 23 3 32 3S48 8 50 18l-5-3-4 4-5-4-4 4-4-4-5 4-4-4z",
        fill: SHELL,
        stroke: SHELL_EDGE,
        strokeWidth: 2,
      },
    ];
  }
  const egg: VisorPath = {
    kind: "path",
    d: "M32 6C45 6 54 24 54 38C54 51 44 59 32 59S10 51 10 38C10 24 19 6 32 6Z",
    fill: SHELL,
    stroke: SHELL_EDGE,
    strokeWidth: 2,
  };
  const speck = (cx: number, cy: number, r: number): VisorCircle => ({
    kind: "circle",
    cx,
    cy,
    r,
    fill: c.body,
  });
  if (stage === "egg") return [egg, speck(24, 24, 2.2), speck(40, 33, 2.8), speck(27, 46, 1.8)];
  return [
    egg,
    { kind: "rect", x: 15, y: 27, w: 34, h: 18, r: 9, fill: VISOR },
    ...eyeShapes("idle", c.glow).map((s) => ({ ...s, y: s.y - 1 })),
    {
      kind: "path",
      d: "M13 27l5 4 4-5 5 4 5-5 5 5 5-4 4 5 5-4",
      stroke: SHELL_EDGE,
      strokeWidth: 2,
      linecap: "round",
    },
  ];
}

/**
 * The working eyes glance left, centre, right. They ship as an APNG laid exactly over the
 * visor rect, so the only endless loop costs the main thread nothing; CSS keyframes and JS
 * timers measured far worse.
 */
export const WORKING_SCAN = {
  rect: VIS,
  background: VISOR,
  offsets: [-3, 0, 3],
  frameMs: 300,
  /** Raster pixels per canvas unit, so the overlay stays sharp up to 4× the 64-unit grid. */
  scale: 4,
} as const;

/** Signed distance to a rounded rect; coverage comes from it, so no canvas is needed. */
function roundedRectDistance(
  px: number,
  py: number,
  rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
  r: number,
): number {
  const qx = Math.abs(px - (rect.x + rect.w / 2)) - (rect.w / 2 - r);
  const qy = Math.abs(py - (rect.y + rect.h / 2)) - (rect.h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function segmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

const GLINT_POINTS = Array.from({ length: 13 }, (_, i) => {
  const t = i / 12;
  const u = 1 - t;
  return [
    u * u * GLINT.x0 + 2 * u * t * GLINT.cx + t * t * GLINT.x1,
    u * u * GLINT.y0 + 2 * u * t * GLINT.cy + t * t * GLINT.y1,
  ] as const;
});

function glintDistance(px: number, py: number): number {
  let best = Infinity;
  for (let i = 1; i < GLINT_POINTS.length; i++) {
    const [ax, ay] = GLINT_POINTS[i - 1]!;
    const [bx, by] = GLINT_POINTS[i]!;
    best = Math.min(best, segmentDistance(px, py, ax, ay, bx, by));
  }
  return best - 1.6 / 2;
}

const coverage = (distance: number, scale: number) =>
  Math.max(0, Math.min(1, 0.5 - distance * scale));
const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;

function scanFrame(glow: string, offsetX: number): Uint8Array {
  const { rect, scale } = WORKING_SCAN;
  const width = rect.w * scale;
  const height = rect.h * scale;
  const visor = fromHex(VISOR);
  const lit = fromHex(glow);
  const eyes = eyeShapes("working", glow, offsetX);
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = rect.x + (x + 0.5) / scale;
      const py = rect.y + (y + 0.5) / scale;
      const alpha = coverage(roundedRectDistance(px, py, rect, rect.h / 2), scale);
      const eye = Math.max(
        ...eyes.map((e) => coverage(roundedRectDistance(px, py, e, e.r), scale)),
      );
      const glint = coverage(glintDistance(px, py), scale) * 0.35;
      const at = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        const base = mix(visor[channel]!, lit[channel]!, eye);
        pixels[at + channel] = Math.round(mix(base, 255, glint));
      }
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

/** The visor-sized working loop: WORKING_SCAN.offsets frames of the working eyes. */
export function workingScanApng(avatar: ProjectAvatar): Uint8Array {
  const glow = GLOW[avatar.glow];
  return encodeApng(
    WORKING_SCAN.rect.w * WORKING_SCAN.scale,
    WORKING_SCAN.rect.h * WORKING_SCAN.scale,
    WORKING_SCAN.offsets.map((offset) => scanFrame(glow, offset)),
    WORKING_SCAN.frameMs,
  );
}

const scanUrls = new Map<string, string>();

/** A `data:` URL per glow, memoized; the visor itself is the same on every bot. */
export function workingScanDataUrl(avatar: ProjectAvatar): string {
  let url = scanUrls.get(avatar.glow);
  if (url === undefined) {
    url = `data:image/png;base64,${Base64.encode(workingScanApng(avatar))}`;
    scanUrls.set(avatar.glow, url);
  }
  return url;
}

/** Where the scan overlay sits for an avatar drawn `size` pixels square. */
export function workingScanBox(size: number): {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
} {
  const unit = size / VISOR_CANVAS;
  const { rect } = WORKING_SCAN;
  return { left: rect.x * unit, top: rect.y * unit, width: rect.w * unit, height: rect.h * unit };
}
