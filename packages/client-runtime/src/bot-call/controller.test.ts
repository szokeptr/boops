import { describe, expect, it, vi } from "vite-plus/test";

import {
  BotCallController,
  type BotCallDataChannel,
  type BotCallPeerConnection,
  BotCallStartError,
  type BotCallState,
  type BotCallStream,
} from "./controller.ts";

function setup(
  options: { readonly start?: () => Promise<{ callId: string; sdpAnswer: string }> } = {},
) {
  const listeners = new Map<string, Array<(event?: never) => void>>();
  const on = (type: string, listener: (event?: never) => void) =>
    listeners.set(type, [...(listeners.get(type) ?? []), listener]);
  const emit = (type: string, event?: unknown) =>
    listeners.get(type)?.forEach((listener) => listener(event as never));

  const track = { enabled: true, stop: vi.fn() };
  const microphone: BotCallStream = { getAudioTracks: () => [track], getTracks: () => [track] };
  const channel = {
    readyState: "open",
    send: vi.fn(),
    close: vi.fn(),
    addEventListener: (type: string, listener: () => void) => on(`channel:${type}`, listener),
  } as unknown as BotCallDataChannel & { send: ReturnType<typeof vi.fn> };
  const connection = {
    connectionState: "new",
    addTrack: vi.fn(),
    createDataChannel: () => channel,
    createOffer: async () => ({ sdp: "offer" }),
    setLocalDescription: async () => undefined,
    setRemoteDescription: vi.fn(async () => undefined),
    close: vi.fn(),
    addEventListener: (type: string, listener: () => void) => on(type, listener),
  } as unknown as BotCallPeerConnection & {
    connectionState: string;
    close: ReturnType<typeof vi.fn>;
    setRemoteDescription: ReturnType<typeof vi.fn>;
  };
  const timers: Array<() => void> = [];
  const end = vi.fn(async () => undefined);
  const states: BotCallState[] = [];
  const controller = new BotCallController({
    platform: {
      createPeerConnection: () => connection,
      getMicrophone: async () => microphone,
      now: () => 1_000,
      setTimeout: (callback) => timers.push(callback),
      clearTimeout: () => undefined,
    },
    start: options.start ?? (async () => ({ callId: "rtc_1", sdpAnswer: "answer" })),
    end,
    onStateChange: (state) => states.push(state),
  });
  const setConnectionState = (state: string) => {
    connection.connectionState = state;
    emit("connectionstatechange");
  };
  const live = (event: Record<string, unknown>) =>
    emit("channel:message", { data: JSON.stringify(event) });
  return {
    controller,
    connection,
    channel,
    track,
    end,
    timers,
    setConnectionState,
    live,
    emit,
  };
}

describe("BotCallController", () => {
  it("goes live once audio connects", async () => {
    const call = setup();
    await call.controller.start();
    expect(call.connection.setRemoteDescription).toHaveBeenCalledWith({
      type: "answer",
      sdp: "answer",
    });
    call.setConnectionState("connected");
    expect(call.controller.currentState).toMatchObject({ phase: "live", connectedAt: 1_000 });
  });

  it("hangs up when OpenAI ends the session", async () => {
    const call = setup();
    await call.controller.start();
    call.setConnectionState("connected");
    call.live({ type: "session.closed", reason: "expired" });
    expect(call.controller.currentState.phase).toBe("ended");
    expect(call.end).toHaveBeenCalledWith("rtc_1");
    expect(call.track.stop).toHaveBeenCalled();
    expect(call.connection.close).toHaveBeenCalled();
  });

  it("ends a call that connects after the user already hung up", async () => {
    const { promise: offered, resolve: offer } = Promise.withResolvers<void>();
    const { promise: answered, resolve: answer } = Promise.withResolvers<{
      callId: string;
      sdpAnswer: string;
    }>();
    const call = setup({
      start: () => {
        offer();
        return answered;
      },
    });
    const starting = call.controller.start();
    await offered;
    call.controller.hangUp();
    answer({ callId: "rtc_late", sdpAnswer: "answer" });
    await starting;
    expect(call.end).toHaveBeenCalledWith("rtc_late");
    expect(call.connection.setRemoteDescription).not.toHaveBeenCalled();
    expect(call.controller.currentState.phase).toBe("ended");
  });

  it("says when the environment has no API key", async () => {
    const call = setup({
      start: async () => {
        throw new BotCallStartError("Add an OpenAI API key in Settings.", "not-configured");
      },
    });
    await call.controller.start();
    expect(call.controller.currentState).toMatchObject({
      phase: "failed",
      error: { reason: "not-configured", message: "Add an OpenAI API key in Settings." },
    });
    expect(call.track.stop).toHaveBeenCalled();
  });

  it("rides out a short network drop, but not a long one", async () => {
    const call = setup();
    await call.controller.start();
    call.setConnectionState("connected");
    call.setConnectionState("disconnected");
    call.setConnectionState("connected");
    call.timers.splice(0).forEach((fire) => fire());
    expect(call.controller.currentState.phase).toBe("live");
    call.setConnectionState("disconnected");
    call.timers.splice(0).forEach((fire) => fire());
    expect(call.controller.currentState).toMatchObject({
      phase: "failed",
      error: { reason: "connection" },
    });
  });

  it("shows who is talking and what they say, one turn at a time", async () => {
    const call = setup();
    await call.controller.start();
    call.live({ type: "session.input_transcript.delta", delta: " Any" });
    call.live({ type: "session.input_transcript.delta", delta: " news?" });
    expect(call.controller.currentState).toMatchObject({
      speaker: "user",
      caption: { speaker: "user", text: "Any news?" },
    });
    call.live({ type: "session.output_transcript.delta", delta: "Yes, " });
    call.live({ type: "session.output_transcript.delta", delta: "it's booked." });
    expect(call.controller.currentState).toMatchObject({
      speaker: "bot",
      caption: { speaker: "bot", text: "Yes, it's booked." },
    });
    call.timers.at(-1)!();
    expect(call.controller.currentState.speaker).toBe("none");
    call.live({ type: "session.output_transcript.delta", delta: " Anything else?" });
    expect(call.controller.currentState.caption).toEqual({
      speaker: "bot",
      text: "Anything else?",
    });
    expect(call.controller.currentState.transcript).toEqual([
      { speaker: "user", text: "Any news?" },
      { speaker: "bot", text: "Yes, it's booked." },
      { speaker: "bot", text: "Anything else?" },
    ]);
  });
});
