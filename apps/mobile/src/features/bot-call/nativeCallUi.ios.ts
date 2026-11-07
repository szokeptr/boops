import RNCallKeep, { AudioSessionMode } from "react-native-callkeep";
import { RTCAudioSession } from "react-native-webrtc";

import type { NativeCallUi } from "./botCallSession";
import type { NativeCallUiHandlers } from "./nativeCallUi";

export type { NativeCallUiHandlers } from "./nativeCallUi";

const FAILED = 1;

async function loudspeakerInUse(): Promise<boolean> {
  const routes = await RNCallKeep.getAudioRoutes().catch(() => []);
  return routes.some((route) => route.selected === true && route.type === "Speaker");
}

/**
 * CallKit shows a bot call like a phone call: on the lock screen, in the Dynamic Island and in
 * Recents, and it keeps the call's audio going with the app in the background.
 */
export function createNativeCallUi(handlers: NativeCallUiHandlers): NativeCallUi {
  let activeId: string | null = null;
  let ready: Promise<unknown> | null = null;
  // `handleType` is read natively but missing from the library's types.
  const ios = {
    appName: "Boops",
    handleType: "generic",
    supportsVideo: false,
    includesCallsInRecents: true,
    maximumCallGroups: "1",
    maximumCallsPerCallGroup: "1",
    // Echo cancellation and the earpiece, like a phone call.
    audioSession: { mode: AudioSessionMode.voiceChat },
  };
  const setup = () =>
    (ready ??= RNCallKeep.setup({
      ios,
      android: {
        alertTitle: "",
        alertDescription: "",
        cancelButton: "",
        okButton: "",
        additionalPermissions: [],
      },
    }).catch(() => undefined));

  // CallKit hands the app the audio session; WebRTC must start and stop its audio unit with it.
  RNCallKeep.addEventListener("didActivateAudioSession", () => {
    RTCAudioSession.audioSessionDidActivate();
    if (activeId !== null) {
      const id = activeId;
      void loudspeakerInUse().then((on) => handlers.onSpeakerChanged(id, on));
    }
  });
  RNCallKeep.addEventListener("didDeactivateAudioSession", () => {
    RTCAudioSession.audioSessionDidDeactivate();
  });
  RNCallKeep.addEventListener("didActivateAudioSession", () =>
    console.log("[bot-call-debug] callkit audio activated"),
  );
  RNCallKeep.addEventListener("didDeactivateAudioSession", () =>
    console.log("[bot-call-debug] callkit audio deactivated"),
  );
  RNCallKeep.addEventListener("startCallFailed", (e) =>
    console.log("[bot-call-debug] callkit startCallFailed", JSON.stringify(e)),
  );
  RNCallKeep.addEventListener("endCall", ({ callUUID }) => {
    console.log("[bot-call-debug] callkit endCall", callUUID, "active", activeId);
    if (callUUID === activeId) {
      activeId = null;
      handlers.onEnded(callUUID);
    }
  });
  // CallKit refused the call (another call is on, or Focus filters it); the call goes on in the app.
  RNCallKeep.addEventListener("startCallFailed", ({ callUUID }) => {
    if (callUUID === activeId) activeId = null;
  });
  RNCallKeep.addEventListener("didPerformSetMutedCallAction", ({ callUUID, muted }) => {
    if (callUUID === activeId) handlers.onMuted(callUUID, muted);
  });
  RNCallKeep.addEventListener("didChangeAudioRoute", () => {
    if (activeId === null) return;
    const id = activeId;
    void loudspeakerInUse().then((on) => handlers.onSpeakerChanged(id, on));
  });

  return {
    begin: (id, call) => {
      activeId = id;
      void setup().then(() => {
        if (activeId !== id) return;
        RNCallKeep.startCall(id, call.botName, call.botName, "generic", false);
        RNCallKeep.reportConnectingOutgoingCallWithUUID(id);
      });
    },
    connected: (id) => {
      void setup().then(() => RNCallKeep.reportConnectedOutgoingCallWithUUID(id));
    },
    end: (id, failed) => {
      if (activeId === id) activeId = null;
      void setup().then(() => {
        if (failed) RNCallKeep.reportEndCallWithUUID(id, FAILED);
        else RNCallKeep.endCall(id);
      });
    },
    setMuted: (id, muted) => {
      void setup().then(() => RNCallKeep.setMutedCall(id, muted));
    },
    setSpeaker: async (id, on) => {
      await setup();
      if (on) {
        await RNCallKeep.setAudioRoute(id, "Speaker");
      } else {
        // The built-in microphone's route clears the loudspeaker override.
        const routes = await RNCallKeep.getAudioRoutes();
        const phone = routes.find((route) => route.type === "Phone");
        if (phone !== undefined) await RNCallKeep.setAudioRoute(id, phone.name);
      }
      return loudspeakerInUse();
    },
  };
}
