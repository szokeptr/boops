import {
  EnvironmentMemberId,
  ProjectId,
  RoomId,
  type RoomMessage,
  RoomMessageId,
  type RoomParticipantView,
  RoomsError,
  type RoomSummary,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  canManageRoom,
  insertRoomMention,
  roomAvatarFaces,
  roomFeedEntry,
  roomMentionQuery,
  roomApprovalOptions,
  roomPostFailure,
  roomRowSubtitle,
} from "./roomPresentation";

const scout = ProjectId.make("scout");
const anna = EnvironmentMemberId.make("anna");
const scoutChat = ThreadId.make("scout-chat");
const bots = [{ projectId: scout, name: "Scout", avatar: null, threadId: scoutChat }];

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
    const botMessage = message({
      id: RoomMessageId.make("m2"),
      author: { kind: "bot", projectId: scout },
    });
    // The viewer's conversation with the bot can start after its message was first drawn.
    const beforeChat = roomFeedEntry(botMessage, "owner", [{ ...bots[0]!, threadId: null }]);
    expect(beforeChat.type === "message" && beforeChat.message.sender?.bot?.threadId).toBeNull();
    const fromBot = roomFeedEntry(botMessage, "owner", bots);
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
      sender: { key: "bot:scout", name: "Peter", bot: { avatar: null, threadId: scoutChat } },
    });
    expect(fromAnna.message.sender).toEqual({ key: "member:anna", name: "Peter" });
    // The same message is someone else's to a different viewer.
    const asAnna = roomFeedEntry(message({}), "member:anna", bots);
    expect(asAnna.type === "message" && asAnna.message.role).toBe("assistant");
  });

  it("marks the room's own notes as notices, not someone's bubble", () => {
    const note = roomFeedEntry(
      message({ id: RoomMessageId.make("m4"), author: { kind: "system" }, authorName: "Boops" }),
      "owner",
      bots,
    );
    expect(note.type === "message" && note.message.sender).toEqual({
      key: "system",
      name: "Boops",
      notice: true,
    });
  });
});

describe("roomRowSubtitle", () => {
  it("says who is answering, else the last message without markdown, else who is in it", () => {
    expect(roomRowSubtitle(summary({ working: [scout] }), "owner")).toBe("Answering…");
    expect(
      roomRowSubtitle(
        summary({
          lastMessage: message({
            author: { kind: "bot", projectId: scout },
            authorName: "Scout",
            text: "**Done** now",
          }),
        }),
        "owner",
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
        "member:anna",
      ),
    ).toBe("Peter: Sent an attachment");
    expect(roomRowSubtitle(summary({ lastMessage: message({}) }), "owner")).toBe("You: hi");
    expect(
      roomRowSubtitle(
        summary({
          lastMessage: message({
            author: { kind: "system" },
            authorName: "Boops",
            text: "Anna left.",
          }),
        }),
        "owner",
      ),
    ).toBe("Anna left.");
    expect(roomRowSubtitle(summary({}), "owner")).toBe("3 in the chat");
  });
});

describe("roomApprovalOptions", () => {
  it("offers the provider's choices a room allows, else Allow once and Decline", () => {
    expect(roomApprovalOptions(undefined).map((option) => option.decision)).toEqual([
      "accept",
      "decline",
    ]);
    expect(
      roomApprovalOptions([
        { decision: "decline", label: "No" },
        { decision: "acceptForSession", label: "Always" },
        { decision: "accept", label: "Yes, run it" },
        { decision: "cancel", label: "Stop the turn" },
      ]),
    ).toEqual([
      { decision: "decline", label: "No" },
      { decision: "accept", label: "Yes, run it" },
      { decision: "cancel", label: "Stop the turn" },
    ]);
    expect(
      roomApprovalOptions([{ decision: "acceptForSession", label: "Always" }]).map(
        (option) => option.label,
      ),
    ).toEqual(["Allow once", "Decline"]);
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

describe("roomPostFailure", () => {
  it("says what the room refused, and blames the connection only for transport failures", () => {
    expect(roomPostFailure(new RoomsError({ reason: "not-allowed" }))).toBe(
      "You can't do that in this room.",
    );
    expect(roomPostFailure(new RoomsError({ reason: "empty-message" }))).toBe(
      "Write something or attach a file.",
    );
    expect(roomPostFailure(new Error("SocketCloseError: closed"))).toBe(
      "Check the connection and try again.",
    );
    expect(roomPostFailure(Object.assign(new Error("boom"), { _tag: "RpcClientError" }))).toBe(
      "Check the connection and try again.",
    );
    expect(roomPostFailure("weird")).toBe("Check the connection and try again.");
    expect(roomPostFailure(new Error("The environment is not connected."))).toBe(
      "Check the connection and try again.",
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
