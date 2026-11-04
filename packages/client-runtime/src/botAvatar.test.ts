import { describe, expect, it } from "vite-plus/test";

import { WORKING_DASHES, screenieGrid, screeniePalette, workingDashesApng } from "./botAvatar.ts";

const avatar = { hue: "teal", accessory: "crown", glow: "mint" } as const;

interface PngChunk {
  readonly type: string;
  readonly data: Uint8Array;
}

function chunks(png: Uint8Array): PngChunk[] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out: PngChunk[] = [];
  for (let at = 8; at < png.length;) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    out.push({ type, data: png.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
  }
  return out;
}

const u32 = (data: Uint8Array, at: number) =>
  new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(at);
const u16 = (data: Uint8Array, at: number) =>
  new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(at);

// Stored deflate: 2-byte zlib header, 5-byte block header, then one filter byte per scanline.
const framePixels = (zlib: Uint8Array) => zlib.subarray(2 + 5 + 1, 2 + 5 + 1 + 8 * 4);
const litColumns = (pixels: Uint8Array, glow: string) =>
  Array.from({ length: 8 }, (_, x) => x).filter(
    (x) =>
      `#${[...pixels.subarray(x * 4, x * 4 + 3)].map((c) => c.toString(16).padStart(2, "0")).join("")}` ===
      glow,
  );

describe("workingDashesApng", () => {
  it("loops three 8×1 frames at 300 ms, lighting one more dash each frame", () => {
    const parts = chunks(workingDashesApng(avatar));
    const ihdr = parts.find((part) => part.type === "IHDR")!;
    expect([u32(ihdr.data, 0), u32(ihdr.data, 4)]).toEqual([8, 1]);
    const actl = parts.find((part) => part.type === "acTL")!;
    expect({ frames: u32(actl.data, 0), plays: u32(actl.data, 4) }).toEqual({
      frames: 3,
      plays: 0,
    });

    const delays = parts
      .filter((part) => part.type === "fcTL")
      .map((part) => u16(part.data, 20) / u16(part.data, 22));
    expect(delays).toEqual([0.3, 0.3, 0.3]);

    const glow = screeniePalette(avatar).g;
    const frames = [
      framePixels(parts.find((part) => part.type === "IDAT")!.data),
      ...parts
        .filter((part) => part.type === "fdAT")
        .map((part) => framePixels(part.data.subarray(4))),
    ];
    expect(frames.map((pixels) => litColumns(pixels, glow))).toEqual([
      [0, 1],
      [0, 1, 3, 4],
      [0, 1, 3, 4, 6, 7],
    ]);
  });

  it("sits exactly over the dashes of the static working face", () => {
    const row = screenieGrid(avatar, "working")[WORKING_DASHES.row]!;
    const strip = row.slice(WORKING_DASHES.col, WORKING_DASHES.col + WORKING_DASHES.width);
    expect(strip.map((cell, x) => (cell === "g" ? x : null)).filter((x) => x !== null)).toEqual([
      0, 1, 3, 4, 6, 7,
    ]);
  });
});
