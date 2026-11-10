import { EnvironmentMemberId, RoomId, RoomMessageId, type RoomSummary } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { sortRoomsByActivity } from "./roomList.ts";

const room = (id: string, createdAt: string, lastMessageAt: string | null): RoomSummary => ({
  id: RoomId.make(id),
  title: id,
  createdBy: { kind: "member", memberId: EnvironmentMemberId.make("anna") },
  participants: [],
  joined: true,
  muted: false,
  archivedAt: null,
  createdAt,
  lastMessage:
    lastMessageAt === null
      ? null
      : {
          id: RoomMessageId.make(`${id}-last`),
          roomId: RoomId.make(id),
          seq: 1,
          author: { kind: "owner" },
          authorName: "Peter",
          text: "hi",
          mentions: [],
          attachments: [],
          createdAt: lastMessageAt,
        },
  working: [],
  needsYou: false,
  unread: false,
});

describe("sortRoomsByActivity", () => {
  it("puts the room with the newest message first, counting a quiet room from its creation", () => {
    const old = room("old", "2026-11-01T00:00:00.000Z", "2026-11-09T12:00:00.000Z");
    const quiet = room("quiet", "2026-11-08T00:00:00.000Z", null);
    const stale = room("stale", "2026-11-02T00:00:00.000Z", "2026-11-03T00:00:00.000Z");
    expect(sortRoomsByActivity([stale, quiet, old]).map((entry) => entry.id)).toEqual([
      "old",
      "quiet",
      "stale",
    ]);
  });
});
