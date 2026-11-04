import { describe, expect, it, vi } from "vite-plus/test";

import { act, fakeTimers, render } from "../../test/render";
import { useThreadJumpHintsVisible } from "./Sidebar.logic";

function JumpHints(props: { readonly held: boolean }) {
  return <output>{useThreadJumpHintsVisible(props.held) ? "shown" : "hidden"}</output>;
}

describe("useThreadJumpHintsVisible", () => {
  it("waits for the delay again on a second hold", async () => {
    // The first render reads the clock.
    using _timers = fakeTimers({ now: 0 });
    await using screen = await render(<JumpHints held />, {
      // A bare hook host; nothing here links or navigates.
      router: false,
    });
    await act(() => vi.advanceTimersByTime(1_000));
    await expect.element(screen.getByRole("status")).toHaveTextContent("shown");

    await screen.rerender(<JumpHints held={false} />);
    await expect.element(screen.getByRole("status")).toHaveTextContent("hidden");
    await act(() => vi.advanceTimersByTime(1_000));

    await screen.rerender(<JumpHints held />);
    await expect.element(screen.getByRole("status")).toHaveTextContent("hidden");
    await act(() => vi.advanceTimersByTime(1_000));
    await expect.element(screen.getByRole("status")).toHaveTextContent("shown");
  });
});
