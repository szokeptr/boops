import type { BotCallPeerConnection, BotCallStream } from "@t3tools/client-runtime/bot-call";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { BotCallSession, type BotCallTarget, type NativeCallUi } from "./botCallSession";

const target = (projectId: string): BotCallTarget => ({
  environmentId: EnvironmentId.make("env"),
  projectId: ProjectId.make(projectId),
  threadId: ThreadId.make(`${projectId}-main`),
  botName: projectId,
  botAvatar: null,
});

function setup() {
  const connections: Array<{ state: string; emit: () => void }> = [];
  // One per call, made on demand so a test can wait before the call's connection exists.
  const answers: Array<PromiseWithResolvers<void>> = [];
  const answerOf = (index: number) => (answers[index] ??= Promise.withResolvers<void>());
  const track = { enabled: true, stop: () => undefined };
  const microphone: BotCallStream = { getAudioTracks: () => [track], getTracks: () => [track] };
  const createPeerConnection = () => {
    let onState = () => {};
    const answer = answerOf(connections.length);
    const entry = { state: "new", emit: () => onState() };
    connections.push(entry);
    return {
      get connectionState() {
        return entry.state;
      },
      addTrack: () => undefined,
      createDataChannel: () => ({
        readyState: "connecting",
        send: () => undefined,
        close: () => undefined,
        addEventListener: () => undefined,
      }),
      createOffer: async () => ({ sdp: "offer" }),
      setLocalDescription: async () => undefined,
      setRemoteDescription: async () => answer.resolve(),
      close: () => undefined,
      addEventListener: (type: string, listener: () => void) => {
        if (type === "connectionstatechange") onState = listener;
      },
    } as unknown as BotCallPeerConnection;
  };
  const nativeCallUi = {
    begin: vi.fn(),
    connected: vi.fn(),
    end: vi.fn(),
    setMuted: vi.fn(),
    setSpeaker: vi.fn(async () => true),
  } satisfies NativeCallUi;
  const releaseAudio = vi.fn();
  const endCall = vi.fn(async () => undefined);
  let ids = 0;
  const session = new BotCallSession({
    createId: () => `call-${++ids}`,
    platform: {
      createPeerConnection,
      getMicrophone: async () => microphone,
      now: () => 0,
      setTimeout: () => 0,
      clearTimeout: () => undefined,
    },
    startCall: async () => ({ callId: `rtc_${ids}`, sdpAnswer: "answer" }),
    endCall,
    nativeCallUi,
    ownAudio: () => releaseAudio,
    keepAwake: () => () => undefined,
  });
  const connect = (index = connections.length - 1) => {
    connections[index]!.state = "connected";
    connections[index]!.emit();
  };
  // The call has its id once OpenAI's answer is applied.
  let settled = 0;
  const settle = () => answerOf(settled++).promise;
  return { session, nativeCallUi, releaseAudio, endCall, connect, settle };
}

describe("BotCallSession", () => {
  it("mirrors the call into the system's call UI from dial to hang-up", async () => {
    const { session, nativeCallUi, releaseAudio, connect, settle } = setup();
    session.start(target("wren"));
    expect(nativeCallUi.begin).toHaveBeenCalledWith("call-1", target("wren"));
    await settle();
    connect();
    expect(nativeCallUi.connected).toHaveBeenCalledWith("call-1");
    session.hangUp();
    expect(nativeCallUi.end).toHaveBeenCalledWith("call-1", false);
    expect(releaseAudio).toHaveBeenCalledOnce();
    expect(session.getSnapshot().call?.state.phase).toBe("ended");
    session.dismiss();
    expect(session.getSnapshot().call).toBeNull();
  });

  it("does not tell the system about an end it asked for", async () => {
    const { session, nativeCallUi, endCall, settle } = setup();
    session.start(target("wren"));
    await settle();
    session.endedBySystem("call-1");
    expect(nativeCallUi.end).not.toHaveBeenCalled();
    expect(endCall).toHaveBeenCalledWith(target("wren"), "rtc_1");
    expect(session.getSnapshot().call?.state.phase).toBe("ended");
  });

  it("applies the system's mute without sending it back", async () => {
    const { session, nativeCallUi, settle } = setup();
    session.start(target("wren"));
    await settle();
    session.mutedBySystem("call-1", true);
    expect(session.getSnapshot().call?.state.muted).toBe(true);
    expect(nativeCallUi.setMuted).not.toHaveBeenCalled();
    session.setMuted(false);
    expect(nativeCallUi.setMuted).toHaveBeenCalledWith("call-1", false);
  });

  it("hangs up the call to one bot before calling another, and ignores calling the same bot twice", async () => {
    const { session, nativeCallUi, settle } = setup();
    session.start(target("wren"));
    await settle();
    session.start(target("wren"));
    expect(nativeCallUi.begin).toHaveBeenCalledOnce();
    session.start(target("pace"));
    expect(nativeCallUi.end).toHaveBeenCalledWith("call-1", false);
    expect(session.getSnapshot().call).toMatchObject({ id: "call-2", projectId: "pace" });
  });
});
