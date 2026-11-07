import type { NativeCallUi } from "./botCallSession";

export type NativeCallUiHandlers = {
  readonly onEnded: (id: string) => void;
  readonly onMuted: (id: string, muted: boolean) => void;
  readonly onSpeakerChanged: (id: string, speakerOn: boolean) => void;
};

/** Android shows the call in the app only; CallKit's ConnectionService twin is not linked there. */
export function createNativeCallUi(_handlers: NativeCallUiHandlers): NativeCallUi | null {
  return null;
}
