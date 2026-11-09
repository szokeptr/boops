import {
  EnvironmentMemberId,
  ProjectId,
  RoomId,
  type RoomMessage,
  RoomMessageId,
  type RoomParticipantView,
  type RoomSummary,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  canManageRoom,
  insertRoomMention,
  roomAvatarFaces,
  roomFeedEntry,
  roomMentionQuery,
  roomRowSubtitle,
} from "./roomPresentation";

const scout = ProjectId.make("scout");
const anna = EnvironmentMemberId.make("anna");
const bots = [{ projectId: scout, name: "Scout", avatar: null }];

const message = (overrides: Partial<RoomMessage>): RoomMessage => ({
  id: RoomMessageId.make("m1"),
  roomId: RoomId.make("room"),
  seq: 1,
  author: { kind: "owner" },
  authorName: "Peter",
  text: "hi",
  mentions: [],
  attachments: [],
  createdAt: "2026-11-09T10:00:00.000Z",
  ...overrides,
});

const participants: ReadonlyArray<RoomParticipantView> = [
  { participant: { kind: "owner" }, name: "Peter" },
  { participant: { kind: "member", memberId: anna }, name: "Anna" },
  { participant: { kind: "bot", projectId: scout }, name: "Scout" },
];

const summary = (overrides: Partial<RoomSummary>): RoomSummary => ({
  id: RoomId.make("room"),
  title: "Trip",
  createdBy: { kind: "member", memberId: anna },
  participants,
  joined: true,
  muted: false,
  archivedAt: null,
  createdAt: "2026-11-09T09:00:00.000Z",
  lastMessage: null,
  working: [],
  needsYou: false,
  unread: false,
  ...overrides,
});

describe("roomFeedEntry", () => {
  it("puts your own messages on your side and names everyone else, bots with their face", () => {
    const own = roomFeedEntry(message({}), "owner", bots);
    const fromBot = roomFeedEntry(
      message({ id: RoomMessageId.make("m2"), author: { kind: "bot", projectId: scout } }),
      "owner",
      bots,
    );
    const fromAnna = roomFeedEntry(
      message({ id: RoomMessageId.make("m3"), author: { kind: "member", memberId: anna } }),
      "owner",
      bots,
    );
    if (own.type !== "message" || fromBot.type !== "message" || fromAnna.type !== "message") {
      throw new Error("Expected message entries");
    }
    expect(own.message.role).toBe("user");
    expect(own.message.sender).toBeUndefined();
    expect(fromBot.message).toMatchObject({
      role: "assistant",
      sender: { key: "bot:scout", name: "Peter", bot: { avatar: null } },
    });
    expect(fromAnna.message.sender).toEqual({ key: "member:anna", name: "Peter" });
    // The same message is someone else's to a different viewer.
    const asAnna = roomFeedEntry(message({}), "member:anna", bots);
    expect(asAnna.type === "message" && asAnna.message.role).toBe("assistant");
  });
});

describe("roomRowSubtitle", () => {
  it("says who is answering, else the last message without markdown, else who is in it", () => {
    expect(roomRowSubtitle(summary({ working: [scout] }))).toBe("Answering…");
    expect(
      roomRowSubtitle(
        summary({ lastMessage: message({ authorName: "Scout", text: "**Done** now" }) }),
      ),
    ).toBe("Scout: Done now");
    expect(
      roomRowSubtitle(
        summary({
          lastMessage: message({
            text: "",
            attachments: [
              { type: "file", id: "a", name: "a.pdf", mimeType: "application/pdf", sizeBytes: 1 },
            ],
          }),
        }),
      ),
    ).toBe("Peter: Sent an attachment");
    expect(roomRowSubtitle(summary({}))).toBe("3 in the chat");
  });
});

describe("roomAvatarFaces", () => {
  it("shows a bot and someone else, or the viewer when they are its only person", () => {
    const names = (list: ReadonlyArray<RoomParticipantView>, viewer: string) =>
      roomAvatarFaces(list, viewer).map((entry) => entry.name);
    expect(names(participants, "owner")).toEqual(["Scout", "Anna"]);
    expect(names([participants[0]!, participants[2]!], "owner")).toEqual(["Scout", "Peter"]);
    expect(names(participants.slice(0, 2), "owner")).toEqual(["Anna", "Peter"]);
  });
});

describe("canManageRoom", () => {
  it("lets the owner and the room's creator manage it", () => {
    const room = summary({});
    expect(canManageRoom(room, { kind: "owner" })).toBe(true);
    expect(canManageRoom(room, { kind: "member", memberId: anna })).toBe(true);
    expect(canManageRoom(room, { kind: "member", memberId: EnvironmentMemberId.make("bob") })).toBe(
      false,
    );
  });
});

describe("room mentions", () => {
  it("offers bots for an @ at the caret and inserts the full name", () => {
    expect(roomMentionQuery("ask @Sc", 7)).toEqual({ query: "Sc", start: 4 });
    expect(roomMentionQuery("mail@Sc", 7)).toBeNull();
    expect(roomMentionQuery("@Scout hi", 9)).toBeNull();
    expect(insertRoomMention("ask @Sc later", { start: 4 }, 7, "Scout")).toEqual({
      text: "ask @Scout  later",
      cursor: 11,
    });
  });
});
