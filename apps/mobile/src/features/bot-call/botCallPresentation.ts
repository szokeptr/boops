import type { BotCallState } from "@t3tools/client-runtime/bot-call";

/** "0:42", "12:05", or "1:02:03". */
export function formatCallDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/** The line under the bot's name on the call screen. */
export function callStatusLabel(state: BotCallState, now: number): string {
  switch (state.phase) {
    case "connecting":
      return "Calling…";
    case "live":
      return formatCallDuration(((now - (state.connectedAt ?? now)) / 1000) | 0);
    case "ending":
    case "ended":
      return "Call ended";
    case "failed":
      return state.error?.message ?? "The call dropped.";
  }
}

/** The finished call's row in the conversation: "Call · 4 min". */
export function callRecapLabel(durationSeconds: number | undefined): string {
  if (durationSeconds === undefined) return "Call";
  if (durationSeconds < 60) return "Call · under a minute";
  return `Call · ${Math.round(durationSeconds / 60)} min`;
}

export type CallRecapLine = {
  readonly speaker: "user" | "bot";
  /** Who spoke: "You", or the bot's name as the transcript recorded it. */
  readonly name: string;
  readonly text: string;
};

// Each line of a call's transcript starts "User: " or "<bot name>: ".
const SPEAKER_PREFIX = /^([^:\n]{1,80}): /;

/** Splits a call's transcript back into who said what. */
export function callRecapLines(text: string): ReadonlyArray<CallRecapLine> {
  const lines: CallRecapLine[] = [];
  // A long call's transcript is clipped from the front.
  for (const raw of text.replace(/^…/, "").split(/\r?\n/)) {
    const prefix = SPEAKER_PREFIX.exec(raw);
    if (prefix !== null) {
      const name = prefix[1]!;
      lines.push({
        speaker: name === "User" ? "user" : "bot",
        name: name === "User" ? "You" : name,
        text: raw.slice(prefix[0].length),
      });
    } else if (lines.length > 0 && raw.trim() !== "") {
      const last = lines.pop()!;
      lines.push({ ...last, text: `${last.text}\n${raw}` });
    }
  }
  return lines;
}

export type CallTranscriptLine = { readonly speaker: "user" | "bot"; readonly text: string };

/** Everything said on the call so far, oldest first; the latest caption until the call has more. */
export function callTranscript(state: BotCallState): ReadonlyArray<CallTranscriptLine> {
  const transcript = (state as { readonly transcript?: ReadonlyArray<CallTranscriptLine> })
    .transcript;
  if (transcript !== undefined && transcript.length > 0) return transcript;
  return state.caption === null ? [] : [state.caption];
}
