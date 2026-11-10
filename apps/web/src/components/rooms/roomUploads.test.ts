import { RoomId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { roomsWithoutViewer } from "./roomUploads";

describe("roomsWithoutViewer", () => {
  it("names staged rooms that were deleted or that the viewer is no longer in", () => {
    const [kept, deleted, removed] = ["kept", "deleted", "removed"].map((id) => RoomId.make(id));
    expect(
      roomsWithoutViewer(
        [kept!, deleted!, removed!],
        [
          { id: kept!, joined: true },
          { id: removed!, joined: false },
        ],
      ),
    ).toEqual([deleted, removed]);
  });
});
