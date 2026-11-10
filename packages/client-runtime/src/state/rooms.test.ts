import { RoomId, RoomMessageId, type RoomFeedItem, type RoomMessage } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { applyRoomFeedItem, joinRoomMessages, type RoomFeedState } from "./rooms.ts";

const roomId = RoomId.make("room-1");
const message = (seq: number): RoomMessage => ({
  id: RoomMessageId.make(`m${seq}`),
  roomId,
  seq,
  author: { kind: "owner" },
  authorName: "Owner",
  text: `message ${seq}`,
  mentions: [],
  attachments: [],
  createdAt: "2026-11-10T10:00:00.000Z",
});
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => message(from + index));
const snapshot = (messages: ReadonlyArray<RoomMessage>, hasOlder: boolean): RoomFeedItem => ({
  kind: "snapshot",
  history: { messages, hasOlder },
});
const empty: RoomFeedState = { messages: [], hasOlder: false, working: [], requests: [] };
const seqs = (messages: ReadonlyArray<RoomMessage>) => messages.map((entry) => entry.seq);

describe("applyRoomFeedItem", () => {
  it("takes the first snapshot as the view", () => {
    const state = applyRoomFeedItem(empty, snapshot(range(51, 100), true));
    expect(seqs(state.messages)).toEqual(range(51, 100).map((entry) => entry.seq));
    expect(state.hasOlder).toBe(true);
  });

  it("keeps messages a reconnect's snapshot no longer reaches when they join up", () => {
    let state = applyRoomFeedItem(empty, snapshot(range(51, 100), true));
    for (const next of range(101, 130))
      state = applyRoomFeedItem(state, { kind: "message", message: next });
    // Reconnected after two more messages: the newest page now starts at 83.
    state = applyRoomFeedItem(state, snapshot(range(83, 132), true));
    expect(seqs(state.messages)).toEqual(range(51, 132).map((entry) => entry.seq));
    expect(state.hasOlder).toBe(true);
  });

  it("starts over from a reconnect's snapshot that leaves a gap", () => {
    let state = applyRoomFeedItem(empty, snapshot(range(1, 10), false));
    state = applyRoomFeedItem(state, snapshot(range(61, 110), true));
    expect(seqs(state.messages)).toEqual(range(61, 110).map((entry) => entry.seq));
    expect(state.hasOlder).toBe(true);
  });

  it("shows a message once, by id", () => {
    let state = applyRoomFeedItem(empty, snapshot(range(1, 3), false));
    state = applyRoomFeedItem(state, { kind: "message", message: message(3) });
    state = applyRoomFeedItem(state, snapshot(range(2, 4), true));
    state = applyRoomFeedItem(state, { kind: "message", message: message(4) });
    expect(seqs(state.messages)).toEqual([1, 2, 3, 4]);
    expect(state.hasOlder).toBe(false);
  });
});

describe("joinRoomMessages", () => {
  it("puts earlier pages before the feed when they join up", () => {
    expect(
      seqs(
        joinRoomMessages(
          { messages: range(1, 50), hasOlder: false },
          { messages: range(51, 60), hasOlder: true },
        ).messages,
      ),
    ).toEqual(range(1, 60).map((entry) => entry.seq));
  });

  it("drops earlier pages that no longer reach the feed, so no hole shows", () => {
    const joined = joinRoomMessages(
      { messages: range(1, 50), hasOlder: false },
      { messages: range(83, 132), hasOlder: true },
    );
    expect(seqs(joined.messages)).toEqual(range(83, 132).map((entry) => entry.seq));
    expect(joined.hasOlder).toBe(true);
    expect(joined.olderUsed).toBe(false);
  });
});
