import { describe, expect, it } from "vite-plus/test";

import "~/index.css";
import { render } from "../../../test/render";
import { BotAvatar } from "./BotAvatar";

const avatar = { hue: "teal", accessory: "crown", glow: "mint" } as const;
const statuses = ["idle", "working", "needs-you", "dozing"] as const;

describe("BotAvatar", () => {
  it("lays the scan loop exactly over the visor, only while working", async () => {
    for (const status of statuses) {
      await using screen = await render(
        <BotAvatar avatar={avatar} name="Juniper" status={status} size={48} />,
        {
          // Nothing here links or navigates.
          router: false,
        },
      );
      const scan = screen.container.querySelector<HTMLImageElement>(
        '[data-slot="bot-avatar-scan"]',
      );
      if (status !== "working") {
        expect(scan).toBeNull();
        continue;
      }
      const sprite = screen.getByRole("img", { name: "Juniper, working" }).element();
      const box = sprite.getBoundingClientRect();
      const overlay = scan!.getBoundingClientRect();
      // The visor is x 13, y 26, 38 × 22 on the 64-unit canvas.
      expect({
        left: overlay.left - box.left,
        top: overlay.top - box.top,
        width: overlay.width,
        height: overlay.height,
      }).toEqual({ left: 9.75, top: 19.5, width: 28.5, height: 16.5 });
      expect(scan!.src).toMatch(/^data:image\/png;base64,/);
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
});
