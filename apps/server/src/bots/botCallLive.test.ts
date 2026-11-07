import { describe, expect, it } from "@effect/vitest";

import {
  type CallEffect,
  type CallState,
  callSessionConfig,
  initialCallState,
  onServerEvent,
  recapText,
  releaseDelegation,
  requestMessage,
} from "./botCallLive.ts";

const said = (speaker: "user" | "bot", delta: string, startMs: number, endMs: number) => ({
  type: speaker === "user" ? "session.input_transcript.delta" : "session.output_transcript.delta",
  delta,
  start_ms: startMs,
  end_ms: endMs,
});

const delegated = (id: string, offsetMs: number) => ({
  type: "session.delegation.created",
  offset_ms: offsetMs,
  delegation: { id, type: "delegation", target: "client" },
});

function play(events: ReadonlyArray<Record<string, unknown>>, from: CallState = initialCallState) {
  let state = from;
  const effects: CallEffect[] = [];
  for (const event of events) {
    const step = onServerEvent(state, event);
    state = step.state;
    effects.push(...step.effects);
  }
  return { state, effects };
}

describe("onServerEvent", () => {
  it("picks up once the session starts, but not over a user who spoke first", () => {
    const greeted = play([{ type: "session.started" }, { type: "session.started" }]);
    expect(greeted.effects).toEqual([
      {
        type: "send",
        event: expect.objectContaining({
          type: "session.commentary.append",
          delegation_id: null,
        }),
      },
    ]);
    expect(play([said("user", "Hello?", 0, 400), { type: "session.started" }]).effects).toEqual([]);
  });

  it("hands each delegation the user's words since the last one, once the transcript has them", () => {
    const first = play([
      said("bot", "Hey, what's", 0, 400),
      said("bot", " up?", 400, 800),
      said("user", "Book the dentist", 1000, 1800),
      delegated("del_1", 2100),
    ]);
    expect(first.effects).toEqual([{ type: "await-transcript", delegationId: "del_1" }]);

    const second = play(
      [
        said("user", " for Tuesday.", 1800, 2000),
        said("bot", "On it.", 2200, 2800),
        said("user", "Oh, and remind me", 3000, 3500),
        delegated("del_2", 3600),
      ],
      first.state,
    );
    expect(second.effects).toEqual([
      {
        type: "delegate",
        delegationId: "del_1",
        request: "Book the dentist for Tuesday.",
        context: [{ speaker: "bot", text: "Hey, what's up?" }],
      },
      { type: "await-transcript", delegationId: "del_2" },
    ]);

    const late = releaseDelegation(second.state, "del_2");
    expect(late.effects).toEqual([
      expect.objectContaining({ delegationId: "del_2", request: "Oh, and remind me" }),
    ]);
    expect(releaseDelegation(late.state, "del_2").effects).toEqual([]);
  });

  it("waits for the user to finish a sentence the model delegated in the middle of", () => {
    const step = play([
      said("user", "Book the", 0, 300),
      delegated("del_1", 200),
      said("user", " dentist.", 300, 600),
      said("bot", "Sure, one moment.", 700, 1400),
    ]);
    expect(step.effects).toEqual([
      { type: "await-transcript", delegationId: "del_1" },
      { type: "delegate", delegationId: "del_1", request: "Book the dentist.", context: [] },
    ]);
  });

  it("keeps both sides of the call for its recap", () => {
    const { state } = play([
      said("user", " hey", 0, 200),
      said("user", " Wren ", 200, 400),
      said("bot", "Hey!", 500, 700),
      said("bot", "What's up?", 800, 900),
      said("user", "  ", 1000, 1100),
    ]);
    expect(recapText(state.fragments, "Wren")).toBe("User: hey Wren\nWren: Hey! What's up?");
  });
});

it("tells the conversation what was said just before a request", () => {
  expect(requestMessage("Yes, do that", [{ speaker: "bot", text: "Book Tuesday?" }], "Wren")).toBe(
    "Yes, do that\n\nJust before, on the call:\nWren: Book Tuesday?",
  );
});

it("seeds the session with the conversation and keeps the client to captions", () => {
  const session = callSessionConfig({
    instructions: "Be Wren.",
    voice: "marin",
    recent: [
      { role: "user", text: "Find me a dentist" },
      { role: "assistant", text: "Found three." },
      { role: "note", text: "Reminder fired" },
    ],
  });
  expect(session.input.map((item) => [item.role, item.content[0]!.text])).toEqual([
    ["user", "Find me a dentist"],
    ["assistant", "Found three."],
    ["developer", "Note: Reminder fired"],
    ["developer", expect.stringContaining("greeting")],
  ]);
  expect(session.client.data_channel.allowed_client_events).toEqual([]);
});
