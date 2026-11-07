import { useAtomValue } from "@effect/atom-react";
import {
  BotCallStartError,
  type BotCallPeerConnection,
  type BotCallStream,
} from "@t3tools/client-runtime/bot-call";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom } from "effect/reactivity";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useSyncExternalStore } from "react";
import { makeMutable } from "react-native-reanimated";
import { mediaDevices, RTCPeerConnection } from "react-native-webrtc";

import { acquireAudioSession, releaseAudioSession } from "../../lib/audioSession";
import { uuidv4 } from "../../lib/uuid";
import { projectEnvironment } from "../../state/projects";
import { BotCallSession } from "./botCallSession";
import { createNativeCallUi } from "./nativeCallUi";

let keepAwakeSequence = 0;

const SILENCE = { user: 0, bot: 0 } as const;
const METER_INTERVAL_MS = 100;

/** How loud each side of the call is right now, 0 to 1: your microphone and the bot's voice. */
export const callAudioLevel = makeMutable<{ readonly user: number; readonly bot: number }>(SILENCE);

type StatsReport = { forEach: (visit: (stat: Record<string, unknown>) => void) => void };

// WebRTC reports linear levels; the square root lifts quiet speech into view.
const lift = (level: number) => Math.min(1, Math.sqrt(level) * 1.3);

function loudness(report: StatsReport): { readonly user: number; readonly bot: number } {
  let user = 0;
  let bot = 0;
  report.forEach((stat) => {
    if (stat.kind !== "audio" || typeof stat.audioLevel !== "number") return;
    if (stat.type === "media-source") user = Math.max(user, stat.audioLevel);
    if (stat.type === "inbound-rtp") bot = Math.max(bot, stat.audioLevel);
  });
  return { user: lift(user), bot: lift(bot) };
}

/** Samples the call's audio until its connection closes. */
function meterCall(connection: RTCPeerConnection) {
  callAudioLevel.set(SILENCE);
  const sample = async () => {
    if (connection.connectionState === "closed") {
      callAudioLevel.set(SILENCE);
      return;
    }
    try {
      callAudioLevel.set(loudness((await connection.getStats()) as unknown as StatsReport));
    } catch {
      // The connection closed between the check and the read.
      callAudioLevel.set(SILENCE);
      return;
    }
    setTimeout(() => void sample(), METER_INTERVAL_MS);
  };
  void sample();
}

function keepScreenAwake(): () => void {
  const tag = `bot-call:${++keepAwakeSequence}`;
  const activation = activateKeepAwakeAsync(tag);
  void activation.catch(() => {});
  return () => void activation.then(() => deactivateKeepAwake(tag)).catch(() => {});
}

function startErrorOf(cause: Cause.Cause<unknown>): BotCallStartError {
  const error = Cause.squash(cause);
  if (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    error._tag === "BotCallError" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    const reason =
      "reason" in error && error.reason === "not-configured" ? "not-configured" : "other";
    return new BotCallStartError(error.message, reason);
  }
  return new BotCallStartError("Could not reach your environment.", "other");
}

/** The app has one microphone and one call at a time, so the call outlives any screen. */
const botCallAtom = Atom.make((get) => {
  const registry = get.registry;
  const session: BotCallSession = new BotCallSession({
    createId: uuidv4,
    platform: {
      // react-native-webrtc mirrors the browser API the controller is written against.
      createPeerConnection: () => {
        const pc = new RTCPeerConnection();
        // DEBUG(bot-call-drop): remove before commit.
        pc.addEventListener("connectionstatechange", () =>
          console.log("[bot-call-debug] connectionState", pc.connectionState),
        );
        pc.addEventListener("iceconnectionstatechange", () =>
          console.log("[bot-call-debug] iceConnectionState", pc.iceConnectionState),
        );
        meterCall(pc);
        return pc as unknown as BotCallPeerConnection;
      },
      getMicrophone: async () =>
        (await mediaDevices.getUserMedia({
          audio: true,
          video: false,
        })) as unknown as BotCallStream,
      now: Date.now,
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
    startCall: async (target, sdpOffer) => {
      const result = await runAtomCommand(
        registry,
        projectEnvironment.startBotCall,
        {
          environmentId: target.environmentId,
          input: {
            projectId: target.projectId,
            threadId: target.threadId,
            sdpOffer,
            noiseReduction: "near_field",
          },
        },
        { reportFailure: false },
      );
      if (AsyncResult.isFailure(result)) throw startErrorOf(result.cause);
      return result.value;
    },
    endCall: async (target, callId) => {
      await runAtomCommand(
        registry,
        projectEnvironment.endBotCall,
        { environmentId: target.environmentId, input: { callId } },
        { reportFailure: false },
      );
    },
    nativeCallUi: createNativeCallUi({
      onEnded: (id) => session.endedBySystem(id),
      onMuted: (id, muted) => session.mutedBySystem(id, muted),
      onSpeakerChanged: (id, on) => session.speakerChanged(id, on),
    }),
    ownAudio: () => {
      const token = acquireAudioSession("call");
      return () => void releaseAudioSession(token).catch(() => {});
    },
    keepAwake: keepScreenAwake,
  });
  get.addFinalizer(() => session.dispose());
  return session;
}).pipe(Atom.keepAlive, Atom.withLabel("mobile:bot-call"));

export function useBotCall() {
  const session = useAtomValue(botCallAtom);
  const { call, screenOpen } = useSyncExternalStore(session.subscribe, session.getSnapshot);
  return { call, screenOpen, session };
}
