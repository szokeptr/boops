// @effect-diagnostics nodeBuiltinImport:off - reads the installed native JS bundle for synchronous VM tests.
import * as NodeFS from "node:fs";
import * as NodeVM from "node:vm";
import { describe, expect, it, vi } from "vite-plus/test";

function createList(bundle: string) {
  const source = NodeFS.readFileSync(
    new URL(`../apps/mobile/node_modules/@legendapp/list/${bundle}`, import.meta.url),
    "utf8",
  );
  const completion = source.slice(
    source.indexOf("// src/core/finishScrollTo.ts"),
    source.indexOf("// src/core/doMaintainScrollAtEnd.ts"),
  );
  let now = 0;
  const timers: Array<{ readonly run: () => void; readonly at: number }> = [];
  const resolve = vi.fn();
  const state = {
    props: { data: ["sent", "reply"], horizontal: false },
    scrollingTo: { animated: true, index: 0, offset: 1000, targetOffset: 1000, viewPosition: 1 },
    pendingScrollResolve: resolve as (() => void) | undefined,
    didContainersLayout: true,
    didFinishInitialScroll: true,
    hasScrolled: true,
    scroll: 0,
    scrollPending: 0,
    scrollLength: 800,
    scrollTime: 0,
    lastNativeScrollTime: 0,
    scrollHistory: [],
    scrollAdjustHandler: { getAdjust: () => 0 },
    refScroller: { current: { scrollTo: vi.fn() } },
    scheduledWork: {
      has: () => timers.length > 0,
      frame: vi.fn(),
      timeout: (run: () => void, delay: number) => timers.push({ run, at: now + delay }),
    },
  };
  const ctx = { state };
  const api = NodeVM.runInNewContext(`${completion}\n({ doScrollTo })`, {
    Date: { now: () => now },
    Platform: { OS: "ios" },
    PlatformAdjustBreaksScroll: false,
    SILENT_INITIAL_SCROLL_RETRY_DELAY_MS: 100,
    initialScrollWatchdog: { get: () => undefined, hasNonZeroTargetOffset: () => false },
    cancelScrollCompletionChecks: () => timers.splice(0),
    clampScrollOffset: (_ctx: unknown, offset: number) => offset,
    calculateOffsetForIndex: () => 1000,
    calculateOffsetWithOffsetPosition: (_ctx: unknown, offset: number) => offset,
    toNativeHorizontalOffset: (_state: unknown, offset: number) => offset,
    recalculateSettledScroll: vi.fn(),
  }) as { doScrollTo: (context: typeof ctx, params: Record<string, unknown>) => void };
  return {
    state,
    resolve,
    scroll: () => api.doScrollTo(ctx, { animated: true, horizontal: false, offset: 1000 }),
    nativeScroll(offset: number) {
      state.scrollPending = offset;
      state.lastNativeScrollTime = now;
    },
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const index = timers.findIndex((timer) => timer.at <= end);
        if (index === -1) break;
        const [timer] = timers.splice(index, 1);
        now = Math.max(now, timer!.at);
        timer!.run();
      }
      now = end;
    },
  };
}

describe.each(["react-native.js", "react-native.mjs"])(
  "animated scroll completion (%s)",
  (bundle) => {
    it("settles an animated scroll whose native animation was cut short", () => {
      const list = createList(bundle);
      list.scroll();
      list.nativeScroll(400);
      list.advance(2000);
      expect(list.resolve).toHaveBeenCalledTimes(1);
      expect(list.state.scrollingTo).toBeUndefined();
    });

    it("keeps waiting while native scroll events still arrive", () => {
      const list = createList(bundle);
      list.scroll();
      for (let offset = 100; offset <= 900; offset += 100) {
        list.nativeScroll(offset);
        list.advance(100);
      }
      expect(list.resolve).not.toHaveBeenCalled();
      list.advance(2000);
      expect(list.resolve).toHaveBeenCalledTimes(1);
    });
  },
);
