import { describe, expect, it } from "vite-plus/test";

import "~/index.css";
import { render } from "../../../test/render";
import { BotAvatar, type BotAvatarSize } from "./BotAvatar";

const avatar = { hue: "teal", accessory: "crown", glow: "mint" } as const;
const statuses = ["idle", "working", "needs-you", "dozing"] as const;

describe("BotAvatar", () => {
  it("lays the ticking dashes over sprite row 10, cols 4–11, only while working", async () => {
    for (const status of statuses) {
      await using screen = await render(
        <BotAvatar avatar={avatar} name="Juniper" status={status} size={48} />,
        {
          // Nothing here links or navigates.
          router: false,
        },
      );
      const dashes = screen.container.querySelector<HTMLImageElement>(
        '[data-slot="bot-avatar-dashes"]',
      );
      if (status !== "working") {
        expect(dashes).toBeNull();
        continue;
      }
      const sprite = screen.getByRole("img", { name: "Juniper, working" }).element();
      const box = sprite.getBoundingClientRect();
      const strip = dashes!.getBoundingClientRect();
      expect({
        left: strip.left - box.left,
        top: strip.top - box.top,
        width: strip.width,
        height: strip.height,
      }).toEqual({ left: 12, top: 30, width: 24, height: 3 });
      expect(dashes!.src).toMatch(/^data:image\/png;base64,/);
    }
  });

  it("shows a status dot below 32px and a speech bubble from 32px", async () => {
    const cases: ReadonlyArray<
      readonly [BotAvatarSize, (typeof statuses)[number], "dot" | "bubble" | null]
    > = [
      [16, "needs-you", "dot"],
      [16, "working", "dot"],
      [16, "dozing", null],
      [16, "idle", null],
      [32, "needs-you", "bubble"],
      [32, "dozing", "bubble"],
      [32, "working", null],
      [64, "needs-you", "bubble"],
    ];
    for (const [size, status, mark] of cases) {
      await using screen = await render(
        <BotAvatar avatar={null} name="Juniper" status={status} size={size} />,
        {
          // Nothing here links or navigates.
          router: false,
        },
      );
      const found = (slot: string) =>
        screen.container.querySelector(`[data-slot="bot-avatar-${slot}"]`) !== null;
      expect({ size, status, dot: found("dot"), bubble: found("bubble") }).toEqual({
        size,
        status,
        dot: mark === "dot",
        bubble: mark === "bubble",
      });
    }
  });
});
