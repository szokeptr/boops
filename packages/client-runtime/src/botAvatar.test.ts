import * as NodeZlib from "node:zlib";

import { BOT_AVATAR_ACCESSORIES, BOT_AVATAR_HUES, type ProjectAvatar } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  type BotAvatarStatus,
  WORKING_SCAN,
  type VisorRect,
  hatchShapes,
  visorColors,
  visorShapes,
  workingScanApng,
} from "./botAvatar.ts";

const avatar: ProjectAvatar = { hue: "teal", accessory: "crown", glow: "mint" };

describe("visorShapes", () => {
  it("draws every stored accessory, and drops it when asked", () => {
    for (const accessory of BOT_AVATAR_ACCESSORIES) {
      const look = { ...avatar, accessory };
      const bare = visorShapes(look, "idle", { includeAccessory: false });
      const extra = visorShapes(look).length - bare.length;
      expect({ accessory, drawn: extra > 0 }).toEqual({ accessory, drawn: accessory !== "none" });
    }
  });

  it("gives every stored hue its own body colour", () => {
    const bodies = BOT_AVATAR_HUES.map((hue) => visorColors({ ...avatar, hue }).body);
    for (const body of bodies) expect(body).toMatch(/^#[0-9a-f]{6}$/);
    expect(new Set(bodies).size).toBe(BOT_AVATAR_HUES.length);
  });

  it("shows the status in the eyes", () => {
    const glow = visorColors(avatar).glow;
    const eyes = (status: BotAvatarStatus) =>
      visorShapes(avatar, status)
        .slice(-2)
        .map((shape) => {
          const eye = shape as VisorRect;
          return { w: eye.w, h: eye.h, fill: eye.fill, opacity: eye.opacity };
        });
    expect(eyes("idle")).toEqual(
      Array.from({ length: 2 }, () => ({ w: 6, h: 10, fill: glow, opacity: undefined })),
    );
    expect(eyes("working")).toEqual(
      Array.from({ length: 2 }, () => ({ w: 9, h: 4, fill: glow, opacity: undefined })),
    );
    expect(eyes("needs-you")).toEqual(
      Array.from({ length: 2 }, () => ({ w: 6.5, h: 12, fill: "#ffc23d", opacity: undefined })),
    );
    expect(eyes("dozing")).toEqual(
      Array.from({ length: 2 }, () => ({ w: 8, h: 2, fill: glow, opacity: 0.45 })),
    );
  });

  it("hatches from a plain egg to a capped bot without its accessory", () => {
    expect(hatchShapes(avatar, "egg").some((s) => s.kind === "rect")).toBe(false);
    const cap = hatchShapes(avatar, "cap");
    expect(cap.slice(0, -1)).toEqual(visorShapes(avatar, "idle", { includeAccessory: false }));
  });
});

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

describe("workingScanApng", () => {
  const width = WORKING_SCAN.rect.w * WORKING_SCAN.scale;
  const height = WORKING_SCAN.rect.h * WORKING_SCAN.scale;
  const parts = chunks(workingScanApng(avatar));
  const frames = [
    parts.find((part) => part.type === "IDAT")!.data,
    ...parts.filter((part) => part.type === "fdAT").map((part) => part.data.subarray(4)),
  ].map((data) => new Uint8Array(NodeZlib.inflateSync(data)));
  const pixel = (frame: Uint8Array, x: number, y: number) => {
    const at = y * (width * 4 + 1) + 1 + x * 4;
    return [...frame.subarray(at, at + 4)];
  };

  it("loops three visor-sized frames at 300 ms", () => {
    const ihdr = parts.find((part) => part.type === "IHDR")!;
    expect([u32(ihdr.data, 0), u32(ihdr.data, 4)]).toEqual([152, 88]);
    const actl = parts.find((part) => part.type === "acTL")!;
    expect({ frames: u32(actl.data, 0), plays: u32(actl.data, 4) }).toEqual({
      frames: 3,
      plays: 0,
    });
    const delays = parts
      .filter((part) => part.type === "fcTL")
      .map((part) => u16(part.data, 20) / u16(part.data, 22));
    expect(delays).toEqual([0.3, 0.3, 0.3]);
    expect(frames.map((frame) => frame.length)).toEqual(Array(3).fill((width * 4 + 1) * height));
  });

  it("glances the working eyes left, centre, right over a rounded visor", () => {
    const glow = [0x86, 0xff, 0xcf, 255];
    const midRow = height / 2;
    // The left eye's first fully lit column steps by the 3-unit offset each frame.
    const leftEdges = frames.map((frame) =>
      Array.from({ length: width }, (_, x) => x).find(
        (x) => pixel(frame, x, midRow).join() === glow.join(),
      ),
    );
    expect(leftEdges).toEqual([15, 27, 39]);
    for (const frame of frames) {
      expect(pixel(frame, 0, 0)[3]).toBe(0);
      expect(pixel(frame, 2, midRow)).toEqual([0x1d, 0x1a, 0x2a, 255]);
    }
  });
});
