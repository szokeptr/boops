import { BOT_AVATAR_ACCESSORIES, type ProjectAvatar } from "@t3tools/contracts";
import * as Base64 from "effect/encoding/Base64";

/** Screenie: a 16×16 TV-headed robot. Rows of 8 cells mirror into 16. */
export const SPRITE_SIZE = 16;

export type BotAvatarStatus = "idle" | "working" | "needs-you" | "dozing";
export type BotHatchStage = "egg" | "crack" | "cap";

type PaletteKey =
  | "o"
  | "b"
  | "s"
  | "h"
  | "k"
  | "w"
  | "d"
  | "g"
  | "n"
  | "a"
  | "A"
  | "W"
  | "Y"
  | "G"
  | "L"
  | "R"
  | "E"
  | "e"
  | "f";
export type SpriteGrid = ReadonlyArray<ReadonlyArray<PaletteKey | null>>;
export type SpritePalette = Readonly<Record<PaletteKey, string>>;
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

const GLOW_RGB: Readonly<Record<ProjectAvatar["glow"], Rgb>> = {
  mint: [0x86, 0xff, 0xcf],
  cyan: [0x8f, 0xe9, 0xff],
  white: [0xf2, 0xef, 0xff],
};

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

function paletteRgb(avatar: ProjectAvatar): Readonly<Record<PaletteKey, Rgb>> {
  const h = HUE_DEGREES[avatar.hue];
  const warm = h > 34 && h < 100;
  return {
    o: hslToRgb(h, 45, warm ? 27 : 24),
    b: hslToRgb(h, warm ? 88 : 76, warm ? 66 : 71),
    s: hslToRgb(h - 4, 58, warm ? 53 : 59),
    h: hslToRgb(h + 4, 100, 89),
    k: hslToRgb(h, 40, 13),
    w: [255, 255, 255],
    d: hslToRgb(h, 30, 13),
    g: GLOW_RGB[avatar.glow],
    n: hslToRgb(h, 25, 42),
    a: hslToRgb(h + 150, 80, 64),
    A: hslToRgb(h + 150, 45, 26),
    W: [255, 255, 255],
    Y: fromHex("#ffc23d"),
    G: fromHex("#7fd35e"),
    L: fromHex("#2e6a2a"),
    R: fromHex("#ff6b8b"),
    E: fromHex("#7a5b3e"),
    e: fromHex("#fbf3e2"),
    f: fromHex("#ead7b5"),
  };
}

export function screeniePalette(avatar: ProjectAvatar): SpritePalette {
  const rgb = paletteRgb(avatar);
  return Object.fromEntries(Object.entries(rgb).map(([key, value]) => [key, hex(value)])) as Record<
    PaletteKey,
    string
  >;
}

/** Your bubbles in a bot's DM wear its body colour, inked like its outline so text reads in both themes. */
export function botBubbleColors(avatar: ProjectAvatar): {
  readonly background: string;
  readonly foreground: string;
} {
  const palette = screeniePalette(avatar);
  return { background: palette.b, foreground: palette.k };
}

type MutableGrid = Array<Array<PaletteKey | null>>;
type Layer = { readonly y: number; readonly rows: ReadonlyArray<string> };

const emptyGrid = (width = SPRITE_SIZE, height = SPRITE_SIZE): MutableGrid =>
  Array.from({ length: height }, () => Array<PaletteKey | null>(width).fill(null));

function put(
  grid: MutableGrid,
  rows: ReadonlyArray<string>,
  y0 = 0,
  onlyOver?: ReadonlyArray<PaletteKey>,
): void {
  const width = grid[0]!.length;
  rows.forEach((source, i) => {
    const y = y0 + i;
    if (y < 0 || y >= grid.length) return;
    const row = source.length === width / 2 ? source + [...source].reverse().join("") : source;
    [...row].forEach((cell, x) => {
      if (cell === "." || x >= width) return;
      if (onlyOver && !onlyOver.includes(grid[y]![x]!)) return;
      grid[y]![x] = cell as PaletteKey;
    });
  });
}

// prettier-ignore
const BODY = ["........", "........", "........", "........", "..oooooo", ".ohbbbbb", ".obbdddd", ".obddddd",
  "aobddddd", "aobddddd", "aobddddd", ".obbdddd", ".obbbbbb", ".osbbbbb", "..osssss", "...ooooo"];

// prettier-ignore
const FACE: Readonly<Record<BotAvatarStatus | "happy", Layer>> = {
  idle: { y: 7, rows: [".....gg..gg.....", ".....gg..gg.....", "................", "......g..g......", ".......gg......."] },
  working: { y: 7, rows: ["................", "....ggg..ggg....", "................", "....gg.gg.gg....", "................"] },
  "needs-you": { y: 7, rows: [".....YY..YY.....", ".....YY..YY.....", "................", ".......YY.......", ".......YY......."] },
  dozing: { y: 9, rows: ["....nnn..nnn....", "................", "................"] },
  happy: { y: 7, rows: [".....g....g.....", "....g.g..g.g....", "................", "......g..g......", ".......gg......."] },
};

// prettier-ignore
const ACCESSORY: Readonly<Record<ProjectAvatar["accessory"], Layer | null>> = {
  none: null,
  rabbit: { y: 0, rows: ["..aa....", "...o....", "....o...", ".....o.."] },
  antenna: { y: 0, rows: [".......oo.......", "......oaao......", ".......oo.......", ".......oo......."] },
  handle: { y: 1, rows: ["....oooo", "....o...", "....o..."] },
  sprout: { y: 0, rows: ["..........GG....", "......GG.GGL....", "......LGGL......", "........L......."] },
  bow: { y: 2, rows: ["........oo..oo..", ".......oRRooRRo.", ".......oRRRRRRo.", "........oo..oo.."] },
  phones: { y: 3, rows: ["....AAAA", "..AA....", ".A......", ".A......", "AAA.....", "Aaa.....", "Aaa.....", "Aaa.....", "AAA....."] },
  crown: { y: 0, rows: ["....o..o", "...oYooY", "...oYYYY", "...ooooo"] },
};

// prettier-ignore
const EGGSHELL_CAP = ["......EEEE......", ".....EeeeeE.....", "....EeeeeeeE....", "...EeeeeeefeE...", "...EeEE..EEeE...", "...E..E..E..E..."];

function body(avatar: ProjectAvatar, face: Layer, cap: boolean): MutableGrid {
  const grid = emptyGrid();
  put(grid, BODY);
  if (cap) put(grid, EGGSHELL_CAP, 1);
  else {
    const accessory = ACCESSORY[avatar.accessory];
    if (accessory) put(grid, accessory.rows, accessory.y);
  }
  put(grid, face.rows, face.y);
  put(grid, ["....W...........", "...W............"], 6, ["d"]);
  return grid;
}

export function screenieGrid(avatar: ProjectAvatar, status: BotAvatarStatus): SpriteGrid {
  return body(avatar, FACE[status], false);
}

/** Only the cells that close the idle eyes, laid over the idle sprite for a one-shot blink. */
export function blinkLids(avatar: ProjectAvatar): SpriteGrid {
  const open = screenieGrid(avatar, "idle");
  const lids = emptyGrid();
  open[7]!.forEach((cell, x) => {
    if (cell === "g" || cell === "k" || cell === "w") lids[7]![x] = "d";
  });
  return lids;
}

const EGG_SPECKS = [
  [5, 7],
  [9, 4],
  [11, 8],
  [4, 11],
  [8, 12],
  [10, 13],
  [7, 9],
] as const;

function eggGrid(avatar: ProjectAvatar, cracked: boolean): MutableGrid {
  const grid = emptyGrid();
  const inside = (x: number, y: number) => {
    if (x < 0 || y < 0 || x > 15 || y > 15) return false;
    const rx = y < 9 ? 4.4 + (y / 9) * 2.1 : 6.5;
    return ((x + 0.5 - 8) / rx) ** 2 + ((y + 0.5 - 8.9) / 7.1) ** 2 <= 1;
  };
  for (let y = 0; y < SPRITE_SIZE; y++) {
    for (let x = 0; x < SPRITE_SIZE; x++) {
      if (!inside(x, y)) continue;
      const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      grid[y]![x] = edge ? "E" : x >= 10 && y >= 9 ? "f" : "e";
    }
  }
  put(grid, [".....h..........", "....h..........."], 4, ["e"]);
  grid[4]![5] = "W";
  grid[5]![4] = "W";
  // The stored look has no speck seed; the accessory picks which specks show the body colour.
  const parity = BOT_AVATAR_ACCESSORIES.indexOf(avatar.accessory) % 2;
  EGG_SPECKS.forEach(([x, y], i) => {
    const cell = grid[y]![x];
    if ((parity + i) % 2 === 0 && cell && cell !== "E") grid[y]![x] = "b";
  });
  if (cracked) {
    put(
      grid,
      [
        "................",
        ".....kkkkkk.....",
        "..E.kwkkkwk.E...",
        "...EkkkkkkkE....",
        ".......E........",
      ],
      6,
    );
  }
  return grid;
}

/** Egg, then a crack with eyes peeking out, then the bot wearing its eggshell as a cap. */
export function hatchGrid(avatar: ProjectAvatar, stage: BotHatchStage): SpriteGrid {
  return stage === "cap" ? body(avatar, FACE.happy, true) : eggGrid(avatar, stage === "crack");
}

export type BotAvatarBubble = "needs-you" | "dozing";

/** 9×7 speech bubbles drawn at 1 or 2 px per cell beside the sprite. */
export const BUBBLE_WIDTH = 9;
export const BUBBLE_HEIGHT = 7;
// prettier-ignore
const BUBBLES: Readonly<Record<BotAvatarBubble, ReadonlyArray<string>>> = {
  "needs-you": [".ooooooo.", "oYYYkYYYo", "oYYYkYYYo", "oYYYkYYYo", "oYYYYYYYo", ".oYokooo.", ".oo......"],
  dozing: [".....kkkk", ".......k.", "......k..", ".....kkkk", "kk.......", ".k.......", ".kk......"],
};

export function bubbleGrid(bubble: BotAvatarBubble): SpriteGrid {
  const grid = emptyGrid(BUBBLE_WIDTH, BUBBLE_HEIGHT);
  put(grid, BUBBLES[bubble]);
  return grid;
}

export interface SpriteRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly fill: string;
}

/** Run-length rows of same-coloured cells, so a renderer draws few rects per sprite. */
export function spriteRects(
  grid: SpriteGrid,
  palette: Partial<Readonly<Record<PaletteKey, string>>>,
): ReadonlyArray<SpriteRect> {
  const rects: SpriteRect[] = [];
  grid.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const cell = row[x];
      const fill = cell ? palette[cell] : undefined;
      if (!cell || fill === undefined) {
        x++;
        continue;
      }
      let end = x + 1;
      while (end < row.length && row[end] === cell) end++;
      rects.push({ x, y, width: end - x, fill });
      x = end;
    }
  });
  return rects;
}

/**
 * Where the working dashes sit, in sprite cells. They are an animated PNG so the only
 * endless loop costs the main thread nothing; CSS steps() or a JS timer measured far worse.
 */
export const WORKING_DASHES = {
  col: 4,
  row: 10,
  width: 8,
  height: 1,
  frameCount: 3,
  frameDelayMs: 300,
} as const;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: ReadonlyArray<number>): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n: number) => [(n >>> 8) & 255, n & 255];

function chunk(type: string, data: ReadonlyArray<number>): number[] {
  const typed = [...type].map((c) => c.charCodeAt(0)).concat(data);
  return [...u32(data.length), ...typed, ...u32(crc32(typed))];
}

// One stored (uncompressed) deflate block; frames here are a few dozen bytes.
function zlibStored(raw: ReadonlyArray<number>): number[] {
  let a = 1;
  let b = 0;
  for (const byte of raw) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  const length = raw.length;
  return [
    0x78,
    0x01,
    0x01,
    length & 255,
    (length >>> 8) & 255,
    ~length & 255,
    (~length >>> 8) & 255,
    ...raw,
    ...u32(((b << 16) | a) >>> 0),
  ];
}

/** A looping RGBA APNG. Frames are `width * height * 4` bytes each; stored deflate caps them at 64 KiB. */
function encodeApng(
  width: number,
  height: number,
  frames: ReadonlyArray<Uint8Array>,
  frameDelayMs: number,
): Uint8Array {
  const bytes = [137, 80, 78, 71, 13, 10, 26, 10];
  bytes.push(...chunk("IHDR", [...u32(width), ...u32(height), 8, 6, 0, 0, 0]));
  bytes.push(...chunk("acTL", [...u32(frames.length), ...u32(0)]));
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
    const scanlines: number[] = [];
    for (let y = 0; y < height; y++) {
      scanlines.push(0, ...frame.subarray(y * width * 4, (y + 1) * width * 4));
    }
    const data = zlibStored(scanlines);
    bytes.push(...(i === 0 ? chunk("IDAT", data) : chunk("fdAT", [...u32(sequence++), ...data])));
  });
  bytes.push(...chunk("IEND", []));
  return new Uint8Array(bytes);
}

/** 8×1 strip over the screen: dashes at 0–1, 3–4, 6–7; frame k lights k + 1 of them. */
export function workingDashesApng(avatar: ProjectAvatar): Uint8Array {
  const palette = paletteRgb(avatar);
  const frames = Array.from({ length: WORKING_DASHES.frameCount }, (_, frame) =>
    Uint8Array.from(
      Array.from({ length: WORKING_DASHES.width }, (_, x) => {
        const lit = x % 3 !== 2 && Math.floor(x / 3) <= frame;
        return [...(lit ? palette.g : palette.d), 255];
      }).flat(),
    ),
  );
  return encodeApng(
    WORKING_DASHES.width,
    WORKING_DASHES.height,
    frames,
    WORKING_DASHES.frameDelayMs,
  );
}

const dashUrls = new Map<string, string>();

/** A `data:` URL per look, memoized; a few hundred bytes each. */
export function workingDashesDataUrl(avatar: ProjectAvatar): string {
  const key = `${avatar.hue}/${avatar.glow}`;
  let url = dashUrls.get(key);
  if (url === undefined) {
    url = `data:image/png;base64,${Base64.encode(workingDashesApng(avatar))}`;
    dashUrls.set(key, url);
  }
  return url;
}
