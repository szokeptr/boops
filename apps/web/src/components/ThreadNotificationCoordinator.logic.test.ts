import { describe, expect, it, vi } from "vite-plus/test";

import {
  createThreadNotificationGate,
  observeRoomNotification,
  type RoomSighting,
  type ThreadNotificationObservation,
} from "./ThreadNotificationCoordinator.logic";

const working: ThreadNotificationObservation = {
  attention: null,
  settled: false,
  completedAt: null,
};
const completed = (at: number): ThreadNotificationObservation => ({
  attention: null,
  settled: true,
  completedAt: at,
});
const visible = { archived: false, quiet: false };

function harness() {
  const notify = vi.fn();
  const gate = createThreadNotificationGate<string>(notify);
  let prior: ThreadNotificationObservation | undefined;
  const observe = (next: ThreadNotificationObservation, options = visible) => {
    gate.observe("thread", prior, next, options);
    prior = next;
  };
  return { gate, notify, observe };
}

describe("createThreadNotificationGate", () => {
  it("notifies a completion immediately and only once", () => {
    const { notify, observe } = harness();
    observe(working);
    observe(completed(1));
    expect(notify.mock.calls).toEqual([["thread", "completion"]]);
    observe({ ...completed(1) });
    observe(working);
    observe(completed(1));
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("notifies each newer completion immediately", () => {
    const { notify, observe } = harness();
    observe(working);
    observe(completed(1));
    observe(working);
    observe(completed(2));
    expect(notify.mock.calls).toEqual([
      ["thread", "completion"],
      ["thread", "completion"],
    ]);
    observe(completed(1));
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("notifies attention once and still notifies the subsequent completion", () => {
    const { notify, observe } = harness();
    observe(working);
    const attention = { attention: "run-1:approval", settled: false, completedAt: null };
    observe(attention);
    expect(notify.mock.calls).toEqual([["thread", "input"]]);
    observe({ ...attention });
    expect(notify).toHaveBeenCalledTimes(1);
    observe(working);
    observe(completed(1));
    expect(notify.mock.calls).toEqual([
      ["thread", "input"],
      ["thread", "completion"],
    ]);
  });

  it("does not replay a completion after attention resolves", () => {
    const { notify, observe } = harness();
    observe(working);
    observe(completed(1));
    observe({ attention: "run-1:limited", settled: false, completedAt: null });
    observe(completed(1));
    expect(notify.mock.calls).toEqual([
      ["thread", "completion"],
      ["thread", "input"],
    ]);
  });

  it("never notifies existing, archived or stopped completions, including when unarchived", () => {
    const { notify, observe } = harness();
    observe(completed(1));
    observe(working);
    observe(completed(2), { ...visible, quiet: true });
    observe(completed(2));
    observe(working);
    observe(completed(3), { ...visible, archived: true });
    observe(completed(3));
    expect(notify).not.toHaveBeenCalled();
    observe(working);
    observe(completed(4));
    expect(notify.mock.calls).toEqual([["thread", "completion"]]);
  });

  it("forgets handled completions when a thread is removed or the gate is cleared", () => {
    for (const reset of [
      (gate: ReturnType<typeof createThreadNotificationGate<string>>) => gate.retain(new Set()),
      (gate: ReturnType<typeof createThreadNotificationGate<string>>) => gate.clear(),
    ]) {
      const { gate, notify, observe } = harness();
      observe(completed(1));
      reset(gate);
      gate.observe("thread", undefined, working, visible);
      gate.observe("thread", working, completed(1), visible);
      expect(notify.mock.calls).toEqual([["thread", "completion"]]);
    }
  });
});

describe("observeRoomNotification", () => {
  const read: RoomSighting = {
    lastMessageId: "m1",
    lastAuthor: "person",
    lastMentionsBots: false,
    working: false,
    unread: false,
    needsYou: false,
    muted: false,
    listed: true,
  };
  const fromSomeoneElse = { ...read, lastMessageId: "m2", unread: true };
  const seen = (sighting: RoomSighting) => observeRoomNotification(undefined, sighting).observation;
  const kindsOf = (sightings: ReadonlyArray<RoomSighting>) => {
    let prior = seen(sightings[0]!);
    return sightings.slice(1).map((sighting) => {
      const result = observeRoomNotification(prior, sighting);
      prior = result.observation;
      return result.kind;
    });
  };

  it.each([
    ["someone else's new message", read, fromSomeoneElse, "completion"],
    [
      "another while still unread",
      fromSomeoneElse,
      { ...fromSomeoneElse, lastMessageId: "m3" },
      "completion",
    ],
    ["the viewer's own message", read, { ...read, lastMessageId: "m2" }, null],
    ["the same message again", fromSomeoneElse, fromSomeoneElse, null],
    ["a message in a muted room", read, { ...fromSomeoneElse, muted: true }, null],
    ["a bot newly waiting on the viewer", read, { ...read, needsYou: true }, "input"],
    [
      "a bot waiting on the viewer when muted",
      read,
      { ...read, muted: true, needsYou: true },
      "input",
    ],
    [
      "a message while a bot still waits",
      { ...read, needsYou: true },
      { ...fromSomeoneElse, needsYou: true },
      "completion",
    ],
    ["an archived or left room", read, { ...fromSomeoneElse, listed: false }, null],
    [
      "a room note while still unread",
      fromSomeoneElse,
      { ...fromSomeoneElse, lastMessageId: "note", lastAuthor: "system" },
      null,
    ],
  ] as const)("%s", (_name, prior, next, expected) => {
    expect(kindsOf([prior, next])).toEqual([expected]);
  });

  it("stays quiet the first time it sees a room", () => {
    expect(
      observeRoomNotification(undefined, { ...fromSomeoneElse, needsYou: true }).kind,
    ).toBeNull();
  });

  it("notifies once for a chain of bot replies, when the last one lands", () => {
    const bot = { ...fromSomeoneElse, lastAuthor: "bot" } as const;
    expect(
      kindsOf([
        read,
        { ...bot, lastMessageId: "a", lastMentionsBots: true },
        { ...bot, lastMessageId: "a", lastMentionsBots: true, working: true },
        { ...bot, lastMessageId: "b", working: true },
        { ...bot, lastMessageId: "c" },
      ]),
    ).toEqual([null, null, null, "completion"]);
  });

  it("notifies for a held reply when the room's note ends the chain", () => {
    expect(
      kindsOf([
        read,
        { ...fromSomeoneElse, lastAuthor: "bot", lastMentionsBots: true },
        { ...read, lastMessageId: "note", lastAuthor: "system" },
      ]),
    ).toEqual([null, "completion"]);
  });

  it("owes nothing once the viewer has read the room", () => {
    expect(
      kindsOf([
        read,
        { ...fromSomeoneElse, lastAuthor: "bot", working: true },
        { ...fromSomeoneElse, lastAuthor: "bot", working: true, unread: false },
        { ...read, lastMessageId: "m2", lastAuthor: "bot" },
      ]),
    ).toEqual([null, null, null]);
  });
});
