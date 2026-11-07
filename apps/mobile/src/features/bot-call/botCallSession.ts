import {
  BotCallController,
  type BotCallDependencies,
  type BotCallState,
} from "@t3tools/client-runtime/bot-call";
import type { EnvironmentId, ProjectAvatar, ProjectId, ThreadId } from "@t3tools/contracts";

export type BotCallTarget = {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  readonly botName: string;
  readonly botAvatar: ProjectAvatar | null;
};

export type ActiveBotCall = BotCallTarget & {
  /** The CallKit call's id. */
  readonly id: string;
  readonly state: BotCallState;
  /** Audio plays on the loudspeaker instead of the earpiece. */
  readonly speakerOn: boolean;
};

export type BotCallSnapshot = {
  readonly call: ActiveBotCall | null;
  /** The full call screen is up, so the floating pill stays out of the way. */
  readonly screenOpen: boolean;
};

/** The system's own call UI: CallKit on iOS, nothing on Android. */
export interface NativeCallUi {
  readonly begin: (id: string, call: BotCallTarget) => void;
  readonly connected: (id: string) => void;
  readonly end: (id: string, failed: boolean) => void;
  readonly setMuted: (id: string, muted: boolean) => void;
  /** Resolves to whether the loudspeaker is in use afterwards. */
  readonly setSpeaker: (id: string, on: boolean) => Promise<boolean>;
}

export type BotCallSessionDependencies = {
  readonly createId: () => string;
  readonly platform: BotCallDependencies["platform"];
  readonly startCall: (
    target: BotCallTarget,
    sdpOffer: string,
  ) => ReturnType<BotCallDependencies["start"]>;
  readonly endCall: (target: BotCallTarget, callId: string) => Promise<void>;
  readonly nativeCallUi: NativeCallUi | null;
  /** Takes the app's audio session from playback and dictation; returns the release. */
  readonly ownAudio: () => () => void;
  /** Holds the screen awake; returns the release. */
  readonly keepAwake: () => () => void;
};

const isActive = (state: BotCallState) => state.phase === "connecting" || state.phase === "live";

/**
 * The app's one bot call. It owns the shared controller and mirrors it into the system's call UI,
 * so ending, muting or answering another call from CallKit lands here too.
 */
export class BotCallSession {
  private readonly deps: BotCallSessionDependencies;
  private controller: BotCallController | null = null;
  private snapshot: BotCallSnapshot = { call: null, screenOpen: false };
  private readonly listeners = new Set<() => void>();
  private releaseAudio: (() => void) | null = null;
  private releaseAwake: (() => void) | null = null;
  private reportedConnected = false;
  // An end the system asked for must not be reported back to it.
  private endedNatively = false;

  constructor(deps: BotCallSessionDependencies) {
    this.deps = deps;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): BotCallSnapshot => this.snapshot;

  /** Calls the bot, hanging up a call to another bot first. Calling the bot already on the line does nothing. */
  start(target: BotCallTarget): void {
    const current = this.snapshot.call;
    if (current !== null && isActive(current.state)) {
      if (
        current.projectId === target.projectId &&
        current.environmentId === target.environmentId
      ) {
        return;
      }
      this.hangUp();
    }
    const id = this.deps.createId();
    this.reportedConnected = false;
    this.endedNatively = false;
    const controller = new BotCallController({
      platform: this.deps.platform,
      start: (sdpOffer) => this.deps.startCall(target, sdpOffer),
      end: (callId) => this.deps.endCall(target, callId),
      onStateChange: (state) => {
        if (this.controller === controller) this.onState(state);
      },
    });
    this.controller = controller;
    this.releaseAudio = this.deps.ownAudio();
    this.releaseAwake = this.deps.keepAwake();
    this.publish({ ...target, id, state: controller.currentState, speakerOn: false });
    this.deps.nativeCallUi?.begin(id, target);
    void controller.start();
  }

  hangUp(): void {
    this.controller?.hangUp();
  }

  /** The system ended the call, from the lock screen or by answering another call. */
  endedBySystem(id: string): void {
    console.log("[bot-call-debug] endedBySystem", id);
    if (this.snapshot.call?.id !== id) return;
    this.endedNatively = true;
    this.hangUp();
  }

  setMuted(muted: boolean): void {
    const call = this.snapshot.call;
    if (call === null || !isActive(call.state)) return;
    this.controller?.setMuted(muted);
    this.deps.nativeCallUi?.setMuted(call.id, muted);
  }

  /** The system's mute button; already applied there. */
  mutedBySystem(id: string, muted: boolean): void {
    if (this.snapshot.call?.id === id && this.snapshot.call.state.muted !== muted) {
      this.controller?.setMuted(muted);
    }
  }

  async setSpeaker(on: boolean): Promise<void> {
    const call = this.snapshot.call;
    if (call === null || this.deps.nativeCallUi === null) return;
    const speakerOn = await this.deps.nativeCallUi
      .setSpeaker(call.id, on)
      .catch(() => call.speakerOn);
    this.speakerChanged(call.id, speakerOn);
  }

  /** The audio route changed, for example when headphones connect. */
  speakerChanged(id: string, speakerOn: boolean): void {
    const call = this.snapshot.call;
    if (call?.id === id && call.speakerOn !== speakerOn) this.publish({ ...call, speakerOn });
  }

  /** Forgets a call that has ended, once its screen is gone. */
  dismiss(): void {
    const call = this.snapshot.call;
    if (call !== null && !isActive(call.state)) this.publish(null);
  }

  dispose(): void {
    this.hangUp();
    this.listeners.clear();
  }

  private onState(state: BotCallState): void {
    // DEBUG(bot-call-drop): remove before commit.
    console.log(
      "[bot-call-debug] state",
      state.phase,
      state.error?.message ?? "",
      new Error().stack?.split("\n").slice(1, 6).join(" | "),
    );
    const call = this.snapshot.call;
    if (call === null) return;
    if (state.phase === "live" && !this.reportedConnected) {
      this.reportedConnected = true;
      this.deps.nativeCallUi?.connected(call.id);
    }
    if ((state.phase === "ended" || state.phase === "failed") && this.controller !== null) {
      this.controller = null;
      if (!this.endedNatively) this.deps.nativeCallUi?.end(call.id, state.phase === "failed");
      this.releaseAudio?.();
      this.releaseAudio = null;
      this.releaseAwake?.();
      this.releaseAwake = null;
    }
    this.publish({ ...call, state });
  }

  setScreenOpen(screenOpen: boolean): void {
    if (this.snapshot.screenOpen === screenOpen) return;
    this.snapshot = { ...this.snapshot, screenOpen };
    for (const listener of this.listeners) listener();
  }

  private publish(call: ActiveBotCall | null): void {
    this.snapshot = { ...this.snapshot, call };
    for (const listener of this.listeners) listener();
  }
}
