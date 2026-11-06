import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";
import { render } from "../../../test/render";
import { BotAvatar } from "./BotAvatar";

const avatar = { hue: "teal", accessory: "crown", glow: "mint", shape: "gumdrop" } as const;
const statuses = ["idle", "working", "needs-you", "dozing"] as const;

describe("BotAvatar", () => {
  it("lays the dots loop over the eye line, only while working", async () => {
    for (const status of statuses) {
      await using screen = await render(
        <BotAvatar avatar={avatar} name="Juniper" status={status} size={48} />,
        {
          // Nothing here links or navigates.
          router: false,
        },
      );
      const dots = screen.container.querySelector<HTMLImageElement>(
        '[data-slot="bot-avatar-dots"]',
      );
      if (status !== "working") {
        expect(dots).toBeNull();
        continue;
      }
      const sprite = screen.getByRole("img", { name: "Juniper, working" }).element();
      const box = sprite.getBoundingClientRect();
      const overlay = dots!.getBoundingClientRect();
      // A gumdrop's eyes sit at y 33; the overlay spans x 17, y 23, 30 × 15 on the 64-unit canvas.
      expect({
        left: overlay.left - box.left,
        top: overlay.top - box.top,
        width: overlay.width,
        height: overlay.height,
      }).toEqual({ left: 12.75, top: 17.25, width: 22.5, height: 11.25 });
      expect(dots!.src).toMatch(/^data:image\/png;base64,/);
    }
  });

  it("shows a status dot only below 24px", async () => {
    const cases = [
      [16, "needs-you", true],
      [16, "working", true],
      [16, "dozing", false],
      [16, "idle", false],
      [32, "needs-you", false],
      [32, "working", false],
    ] as const;
    for (const [size, status, dot] of cases) {
      await using screen = await render(
        <BotAvatar avatar={null} name="Juniper" status={status} size={size} />,
        {
          // Nothing here links or navigates.
          router: false,
        },
      );
      const found = screen.container.querySelector('[data-slot="bot-avatar-dot"]') !== null;
      expect({ size, status, dot: found }).toEqual({ size, status, dot });
    }
  });

  it("turns open eyes toward the pointer from 32px, and lets them rest when they close", async () => {
    await using screen = await render(
      <div className="flex gap-4">
        <BotAvatar avatar={avatar} name="Idle" status="idle" size={64} />
        <BotAvatar avatar={avatar} name="Asking" status="needs-you" size={64} />
        <BotAvatar avatar={avatar} name="Dozing" status="dozing" size={64} />
        <BotAvatar avatar={avatar} name="Small" status="idle" size={24} />
      </div>,
      {
        // Nothing here links or navigates.
        router: false,
      },
    );
    const eyes = (name: string) => {
      const sprite = screen.getByRole("img", { name: new RegExp(`^${name},`) }).element();
      return sprite.querySelector("svg > g")!;
    };
    const glance = (name: string) => Number.parseFloat(getComputedStyle(eyes(name)).translate);
    // Just past the last avatar and below the row, within reach of every one of them.
    const last = screen
      .getByRole("img", { name: /^Small,/ })
      .element()
      .getBoundingClientRect();
    window.dispatchEvent(
      new PointerEvent("pointermove", { clientX: last.right + 20, clientY: last.bottom + 40 }),
    );
    await vi.waitFor(() => {
      expect(glance("Idle")).toBeGreaterThan(1);
      expect(glance("Asking")).toBeGreaterThan(1);
    });
    expect(getComputedStyle(eyes("Dozing")).translate).toBe("none");
    expect(getComputedStyle(eyes("Small")).translate).toBe("none");
  });
});
