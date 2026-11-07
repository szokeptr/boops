/**
 * One voice call with a bot, shared by web and mobile. Audio flows between this client and
 * OpenAI over WebRTC; the environment only trades the offer for an answer and follows the call
 * from its side. The data channel's events drive what the call screen shows.
 */

export type BotCallPhase = "connecting" | "live" | "ending" | "ended" | "failed";

/** Who is talking right now. */
export type BotCallSpeaker = "none" | "user" | "bot";

type BotCallLine = { readonly speaker: "user" | "bot"; readonly text: string };

export type BotCallState = {
  readonly phase: BotCallPhase;
  readonly muted: boolean;
  readonly speaker: BotCallSpeaker;
  /** The latest line said, for live captions. */
  readonly caption: BotCallLine | null;
  /** The call so far, oldest first; the last line is the caption. Keeps the latest lines only. */
  readonly transcript: ReadonlyArray<BotCallLine>;
  /** Epoch ms the audio connected; the call timer counts from it. */
  readonly connectedAt: number | null;
  readonly error: {
    readonly message: string;
    /** `not-configured`: the environment has no OpenAI API key. */
    readonly reason: "not-configured" | "microphone" | "connection" | "other";
  } | null;
};

const INITIAL_BOT_CALL_STATE: BotCallState = {
  phase: "connecting",
  muted: false,
  speaker: "none",
  caption: null,
  transcript: [],
  connectedAt: null,
  error: null,
};

// The slices of the WebRTC API the call uses; browsers and react-native-webrtc both fit.
export interface BotCallTrack {
  enabled: boolean;
  stop(): void;
}

export interface BotCallStream {
  getAudioTracks(): ReadonlyArray<BotCallTrack>;
  getTracks(): ReadonlyArray<BotCallTrack>;
}

export interface BotCallDataChannel {
  readonly readyState: string;
  send(data: string): void;
  close(): void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void;
}

export interface BotCallPeerConnection {
  readonly connectionState: string;
  addTrack(track: BotCallTrack, stream: BotCallStream): unknown;
  createDataChannel(label: string): BotCallDataChannel;
  createOffer(): Promise<{ readonly sdp?: string | undefined }>;
  setLocalDescription(description: { readonly type: "offer"; readonly sdp: string }): Promise<void>;
  setRemoteDescription(description: {
    readonly type: "answer";
    readonly sdp: string;
  }): Promise<void>;
  close(): void;
  addEventListener(
    type: "track",
    listener: (event: { readonly streams: ReadonlyArray<BotCallStream> }) => void,
  ): void;
  addEventListener(type: "connectionstatechange", listener: () => void): void;
}

export class BotCallStartError extends Error {
  readonly reason: "not-configured" | "other";
  constructor(message: string, reason: "not-configured" | "other") {
    super(message);
    this.reason = reason;
  }
}

export interface BotCallPlatform {
  readonly createPeerConnection: () => BotCallPeerConnection;
  /** Rejects when the user refuses the microphone. */
  readonly getMicrophone: () => Promise<BotCallStream>;
  /** Web plays the bot through an audio element; native WebRTC plays it on its own. */
  readonly playRemote?: (stream: BotCallStream) => void;
  readonly stopRemote?: () => void;
  readonly now: () => number;
  readonly setTimeout: (callback: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
}

export interface BotCallDependencies {
  readonly platform: BotCallPlatform;
  /** Trades the offer for OpenAI's answer through the environment. */
  readonly start: (sdpOffer: string) => Promise<{
    readonly callId: string;
    readonly sdpAnswer: string;
  }>;
  readonly end: (callId: string) => Promise<void>;
  readonly onStateChange: (state: BotCallState) => void;
}

// GPT-Live reports no speech events; a speaker counts as talking until their captions pause.
const QUIET_MS = 1_200;
const TRANSCRIPT_LINES = 200;
// A dropped network can come back; WebRTC reports `disconnected` while it tries.
const RECONNECT_GRACE_MS = 10_000;

type LiveEvent = { readonly type?: unknown; readonly delta?: unknown };

export class BotCallController {
  private state: BotCallState = INITIAL_BOT_CALL_STATE;
  private connection: BotCallPeerConnection | null = null;
  private channel: BotCallDataChannel | null = null;
  private microphone: BotCallStream | null = null;
  private callId: string | null = null;
  private quietTimer: unknown = null;
  private reconnectTimer: unknown = null;

  private readonly deps: BotCallDependencies;

  constructor(deps: BotCallDependencies) {
    this.deps = deps;
  }

  get currentState(): BotCallState {
    return this.state;
  }

  async start(): Promise<void> {
    try {
      this.microphone = await this.deps.platform.getMicrophone();
    } catch {
      return this.fail("Boops needs your microphone for calls.", "microphone");
    }
    if (this.isOver()) return this.release();

    const connection = this.deps.platform.createPeerConnection();
    this.connection = connection;
    for (const track of this.microphone.getAudioTracks()) {
      connection.addTrack(track, this.microphone);
    }
    connection.addEventListener("track", (event) => {
      const stream = event.streams[0];
      if (stream !== undefined) this.deps.platform.playRemote?.(stream);
    });
    connection.addEventListener("connectionstatechange", () => this.onConnectionState());

    const channel = connection.createDataChannel("oai-events");
    this.channel = channel;
    channel.addEventListener("message", (event) => this.onEvent(event.data));

    try {
      const offer = await connection.createOffer();
      if (offer.sdp === undefined) throw new Error("No offer");
      await connection.setLocalDescription({ type: "offer", sdp: offer.sdp });
      const { callId, sdpAnswer } = await this.deps.start(offer.sdp);
      this.callId = callId;
      if (this.isOver()) {
        void this.deps.end(callId).catch(() => undefined);
        return this.release();
      }
      await connection.setRemoteDescription({ type: "answer", sdp: sdpAnswer });
    } catch (error) {
      if (this.isOver()) return;
      return error instanceof BotCallStartError
        ? this.fail(error.message, error.reason === "not-configured" ? "not-configured" : "other")
        : this.fail("Could not connect the call.", "connection");
    }
  }

  setMuted(muted: boolean): void {
    for (const track of this.microphone?.getAudioTracks() ?? []) track.enabled = !muted;
    this.update({ muted });
  }

  /** Hangs up. Safe to call more than once. */
  hangUp(): void {
    if (this.isOver()) return;
    this.update({ phase: "ending", speaker: "none" });
    this.finish();
    this.update({ phase: "ended" });
  }

  private isOver(): boolean {
    return (
      this.state.phase === "ending" || this.state.phase === "ended" || this.state.phase === "failed"
    );
  }

  private onConnectionState(): void {
    const connection = this.connection;
    if (connection === null || this.isOver()) return;
    switch (connection.connectionState) {
      case "connected":
        this.clearTimer("reconnect");
        if (this.state.phase === "connecting") {
          this.update({ phase: "live", connectedAt: this.deps.platform.now() });
        }
        return;
      case "disconnected":
        if (this.reconnectTimer === null) {
          this.reconnectTimer = this.deps.platform.setTimeout(() => {
            this.reconnectTimer = null;
            if (this.connection?.connectionState !== "connected") {
              this.fail("The call dropped.", "connection");
            }
          }, RECONNECT_GRACE_MS);
        }
        return;
      case "failed":
        return this.fail("The call dropped.", "connection");
      case "closed":
        // OpenAI hung up: the call moved to another device, or it ran out of time.
        return this.hangUp();
    }
  }

  private onEvent(data: unknown): void {
    if (typeof data !== "string") return;
    let event: LiveEvent;
    try {
      event = JSON.parse(data) as LiveEvent;
    } catch {
      return;
    }
    switch (event.type) {
      case "session.input_transcript.delta":
      case "session.output_transcript.delta":
        if (typeof event.delta !== "string") return;
        return this.heard(
          event.type === "session.input_transcript.delta" ? "user" : "bot",
          event.delta,
        );
      case "session.closed":
        // OpenAI ended the session: it ran out of time, or a safety filter stopped it.
        return this.hangUp();
    }
  }

  private heard(speaker: "user" | "bot", delta: string): void {
    // A caption grows while its speaker keeps talking; the next turn starts a new one.
    const caption = this.state.caption;
    const continues = this.state.speaker === speaker && caption?.speaker === speaker;
    const text = continues ? caption.text + delta : delta.trimStart();
    const line = { speaker, text };
    const earlier = continues ? this.state.transcript.slice(0, -1) : this.state.transcript;
    const transcript = [...earlier, line].slice(-TRANSCRIPT_LINES);
    this.clearTimer("quiet");
    this.quietTimer = this.deps.platform.setTimeout(() => {
      this.quietTimer = null;
      this.update({ speaker: "none" });
    }, QUIET_MS);
    this.update({ speaker, caption: line, transcript });
  }

  private fail(message: string, reason: NonNullable<BotCallState["error"]>["reason"]): void {
    if (this.isOver()) return;
    this.finish();
    this.update({ phase: "failed", speaker: "none", error: { message, reason } });
  }

  private finish(): void {
    if (this.callId !== null) {
      void this.deps.end(this.callId).catch(() => undefined);
      this.callId = null;
    }
    this.release();
  }

  private release(): void {
    this.clearTimer("quiet");
    this.clearTimer("reconnect");
    this.channel?.close();
    this.channel = null;
    this.connection?.close();
    this.connection = null;
    for (const track of this.microphone?.getTracks() ?? []) track.stop();
    this.microphone = null;
    this.deps.platform.stopRemote?.();
  }

  private clearTimer(which: "quiet" | "reconnect"): void {
    const handle = which === "quiet" ? this.quietTimer : this.reconnectTimer;
    if (handle !== null) this.deps.platform.clearTimeout(handle);
    if (which === "quiet") this.quietTimer = null;
    else this.reconnectTimer = null;
  }

  private update(patch: Partial<BotCallState>): void {
    this.state = { ...this.state, ...patch };
    this.deps.onStateChange(this.state);
  }
}
