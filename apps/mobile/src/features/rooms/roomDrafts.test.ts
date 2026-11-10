import { EnvironmentId, RoomId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { roomDraftKey, staleRoomDraftKeys } from "./roomDrafts";

describe("staleRoomDraftKeys", () => {
  it("drops this machine's drafts for rooms you are no longer in, and nothing else", () => {
    const home = EnvironmentId.make("home");
    const work = EnvironmentId.make("work");
    const kept = RoomId.make("trip");
    const gone = RoomId.make("party");
    expect(
      staleRoomDraftKeys(
        [
          roomDraftKey(home, kept),
          roomDraftKey(home, gone),
          roomDraftKey(work, gone),
          "home:thread-1",
          "home:room:party:scout",
        ],
        home,
        [kept],
      ),
    ).toEqual([roomDraftKey(home, gone)]);
  });
});
