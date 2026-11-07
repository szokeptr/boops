import * as NodeZlib from "node:zlib";

import {
  BOT_AVATAR_ACCESSORIES,
  BOT_AVATAR_HUES,
  BOT_AVATAR_SHAPES,
  type ProjectAvatar,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  type AvatarShape,
  WORKING_DOTS,
  avatarColors,
  avatarParts,
  avatarShapes,
  hatchShapes,
  workingDotsApng,
  workingDotsBox,
} from "./botAvatar.ts";

const avatar: ProjectAvatar = { hue: "teal", accessory: "crown", glow: "mint", shape: "gumdrop" };
const outline = (shapes: ReadonlyArray<AvatarShape>) =>
  shapes.filter((shape) => shape.kind === "path" && shape.d.startsWith("M32 ")).length;

describe("avatarShapes", () => {
  it("draws every stored accessory at 24px and up, and drops it below", () => {
    for (const accessory of BOT_AVATAR_ACCESSORIES) {
      const look = { ...avatar, accessory };
      const extra = avatarShapes(look, "idle", 24).length - avatarShapes(look, "idle", 23).length;
      expect({ accessory, drawn: extra > 0 }).toEqual({ accessory, drawn: accessory !== "none" });
    }
  });

  it("gives every stored hue its own body colour", () => {
    const bodies = BOT_AVATAR_HUES.map((hue) => avatarColors({ ...avatar, hue }).body);
    for (const body of bodies) expect(body).toMatch(/^#[0-9a-f]{6}$/);
    expect(new Set(bodies).size).toBe(BOT_AVATAR_HUES.length);
  });

  it("gives every shape its own outline, and treats a look saved before shapes as a gumdrop", () => {
    const outlines = BOT_AVATAR_SHAPES.map(
      (shape) => avatarParts({ ...avatar, accessory: "none", shape }).body[0]!,
    );
    expect(new Set(outlines.map((s) => (s.kind === "path" ? s.d : ""))).size).toBe(8);
    const { shape: _, ...legacy } = avatar;
    expect(avatarShapes(legacy)).toEqual(avatarShapes(avatar));
  });

  it("shows the status in the face, with only looking eyes in the gaze group", () => {
    const face = (status: Parameters<typeof avatarParts>[1], size = 64) => {
      const parts = avatarParts(avatar, status, size);
      return { gaze: parts.gaze.length, overlay: parts.overlay.length };
    };
    // Two eyes, each with a highlight; needs-you adds brows and an amber badge.
    expect(face("idle")).toEqual({ gaze: 4, overlay: 0 });
    expect(face("needs-you")).toEqual({ gaze: 5, overlay: 3 });
    expect(face("happy")).toEqual({ gaze: 2, overlay: 0 });
    // Shut eyes don't follow the pointer, and the working dots are the APNG overlay.
    expect(face("dozing")).toEqual({ gaze: 0, overlay: 1 });
    expect(face("working")).toEqual({ gaze: 0, overlay: 0 });
    // Small avatars drop highlights and badges.
    expect(face("idle", 20)).toEqual({ gaze: 2, overlay: 0 });
    expect(face("needs-you", 20)).toEqual({ gaze: 3, overlay: 0 });
  });

  it("hatches from a plain egg to a capped bot without its accessory", () => {
    expect(outline(hatchShapes(avatar, "egg"))).toBe(1);
    const cap = hatchShapes(avatar, "cap");
    expect(cap.slice(0, -1)).toEqual(avatarShapes({ ...avatar, accessory: "none" }, "idle"));
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

describe("workingDotsApng", () => {
  const width = WORKING_DOTS.width * WORKING_DOTS.scale;
  const height = WORKING_DOTS.height * WORKING_DOTS.scale;
  const parts = chunks(workingDotsApng());
  const frames = [
    parts.find((part) => part.type === "IDAT")!.data,
    ...parts.filter((part) => part.type === "fdAT").map((part) => part.data.subarray(4)),
  ].map((data) => new Uint8Array(NodeZlib.inflateSync(data)));
  const alpha = (frame: Uint8Array, x: number, y: number) =>
    frame[y * (width * 4 + 1) + 1 + x * 4 + 3]!;
  /** The topmost row a dot's centre column covers at all: smaller means it has hopped higher. */
  const peak = (frame: Uint8Array, slot: number) => {
    const x = Math.round((WORKING_DOTS.width / 2 + slot * WORKING_DOTS.gap) * WORKING_DOTS.scale);
    return Array.from({ length: height }, (_, y) => y).find((y) => alpha(frame, x, y) > 0);
  };

  it("loops twelve overlay-sized frames at 90 ms", () => {
    const ihdr = parts.find((part) => part.type === "IHDR")!;
    expect([u32(ihdr.data, 0), u32(ihdr.data, 4)]).toEqual([120, 60]);
    const actl = parts.find((part) => part.type === "acTL")!;
    expect({ frames: u32(actl.data, 0), plays: u32(actl.data, 4) }).toEqual({
      frames: 12,
      plays: 0,
    });
    const delays = parts
      .filter((part) => part.type === "fcTL")
      .map((part) => u16(part.data, 20) / u16(part.data, 22));
    expect(delays).toEqual(Array(12).fill(0.09));
    expect(frames.map((frame) => frame.length)).toEqual(Array(12).fill((width * 4 + 1) * height));
  });

  it("hops the dots left to right on a clear background", () => {
    const highest = [-1, 0, 1].map((slot) => {
      const peaks = frames.map((frame) => peak(frame, slot)!);
      return peaks.indexOf(Math.min(...peaks));
    });
    expect(highest[0]).toBeLessThan(highest[1]!);
    expect(highest[1]).toBeLessThan(highest[2]!);
    for (const frame of frames) expect(alpha(frame, 0, 0)).toBe(0);
  });

  it("sits the overlay on each shape's eye line", () => {
    expect(workingDotsBox(avatar, 64)).toEqual({ left: 17, top: 23, width: 30, height: 15 });
    expect(workingDotsBox({ ...avatar, shape: "onigiri" }, 32).top).toBe(14);
  });
});
