import {
  BotCallController,
  type BotCallPeerConnection,
  BotCallStartError,
  type BotCallState,
  type BotCallStream,
} from "@t3tools/client-runtime/bot-call";
import { runAtomCommand, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ProjectAvatar, ProjectId, ThreadId } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { projectEnvironment } from "./projects";

interface BotCallTarget {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  readonly name: string;
  readonly avatar: ProjectAvatar | null;
}

export interface ActiveBotCall {
  /** Changes with each call, so a new call to the same bot gets a fresh panel. */
  readonly key: number;
  readonly target: BotCallTarget;
  readonly state: BotCallState;
  readonly minimized: boolean;
}

// How long "Call ended" stays up before the panel closes.
const ENDED_LINGER_MS = 2_000;

let active: ActiveBotCall | null = null;
let controller: BotCallController | null = null;
let nextKey = 1;
let dismissTimer: ReturnType<typeof setTimeout> | null = null;
let remoteAudio: HTMLAudioElement | null = null;
const listeners = new Set<() => void>();

function publish(next: ActiveBotCall | null) {
  active = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Asks the environment's answer to a start into to place the call, keeping why it refused. */
async function startCallThroughEnvironment(
  target: Pick<BotCallTarget, "environmentId" | "projectId" | "threadId">,
  sdpOffer: string,
): Promise<{ readonly callId: string; readonly sdpAnswer: string }> {
  const result = await runAtomCommand(
    appAtomRegistry,
    projectEnvironment.startBotCall,
    {
      environmentId: target.environmentId,
      input: {
        projectId: target.projectId,
        threadId: target.threadId,
        sdpOffer,
        noiseReduction: "far_field",
      },
    },
    { reportFailure: false },
  );
  if (result._tag === "Success") return result.value;
  const failure = squashAtomCommandFailure(result);
  if (
    typeof failure === "object" &&
    failure !== null &&
    "_tag" in failure &&
    failure._tag === "BotCallError" &&
    "reason" in failure &&
    "message" in failure &&
    typeof failure.message === "string"
  ) {
    throw new BotCallStartError(
      failure.message,
      failure.reason === "not-configured" ? "not-configured" : "other",
    );
  }
  throw new BotCallStartError(
    failure instanceof Error && failure.message !== ""
      ? failure.message
      : "Could not start the call.",
    "other",
  );
}

function playRemote(stream: BotCallStream) {
  remoteAudio ??= Object.assign(document.createElement("audio"), { autoplay: true });
  remoteAudio.srcObject = stream as unknown as MediaStream;
  void remoteAudio.play().catch(() => undefined);
}

function stopRemote() {
  if (remoteAudio === null) return;
  remoteAudio.pause();
  remoteAudio.srcObject = null;
}

/** Calls the bot. A call already going is hung up first: one call at a time. */
export function startBotCall(target: BotCallTarget): void {
  controller?.hangUp();
  if (dismissTimer !== null) clearTimeout(dismissTimer);
  dismissTimer = null;
  const key = nextKey++;
  const call = new BotCallController({
    platform: {
      createPeerConnection: () => new RTCPeerConnection() as unknown as BotCallPeerConnection,
      getMicrophone: async () =>
        (await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        })) as unknown as BotCallStream,
      playRemote,
      stopRemote,
      now: () => Date.now(),
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
    start: (sdpOffer) => startCallThroughEnvironment(target, sdpOffer),
    end: async (callId) => {
      await runAtomCommand(
        appAtomRegistry,
        projectEnvironment.endBotCall,
        { environmentId: target.environmentId, input: { callId } },
        { reportFailure: false },
      );
    },
    onStateChange: (state) => {
      if (active?.key !== key) return;
      publish({ ...active, state });
      if (state.phase === "ended") {
        dismissTimer = setTimeout(() => {
          dismissTimer = null;
          if (active?.key === key) dismissBotCall();
        }, ENDED_LINGER_MS);
      }
    },
  });
  controller = call;
  publish({ key, target, state: call.currentState, minimized: false });
  void call.start();
}

export function hangUpBotCall(): void {
  controller?.hangUp();
}

export function setBotCallMuted(muted: boolean): void {
  controller?.setMuted(muted);
}

export function setBotCallMinimized(minimized: boolean): void {
  if (active !== null) publish({ ...active, minimized });
}

/** Closes the panel; hangs up first if the call is still going. */
export function dismissBotCall(): void {
  controller?.hangUp();
  controller = null;
  if (dismissTimer !== null) clearTimeout(dismissTimer);
  dismissTimer = null;
  publish(null);
}

export function useActiveBotCall(): ActiveBotCall | null {
  return useSyncExternalStore(
    subscribe,
    () => active,
    () => null,
  );
}
