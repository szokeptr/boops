import type { BotCallSettings, BotCallVoice } from "@t3tools/contracts";

export interface BotCallVoiceGroup {
  readonly label: string;
  readonly voices: ReadonlyArray<{
    readonly voice: BotCallVoice;
    /** Accent and presentation, as OpenAI's GPT-Live voice table lists them. */
    readonly note: string | null;
  }>;
}

// OpenAI documents the newer voices by language; the originals carry no language.
export const BOT_CALL_VOICE_GROUPS: ReadonlyArray<BotCallVoiceGroup> = [
  {
    label: "Any language",
    voices: (
      [
        "marin",
        "cedar",
        "coral",
        "sage",
        "verse",
        "ballad",
        "ash",
        "alloy",
        "shimmer",
        "echo",
      ] as const
    ).map((voice) => ({ voice, note: null })),
  },
  {
    label: "English",
    voices: [
      { voice: "quartz", note: "Australian, feminine" },
      { voice: "ripple", note: "Australian, masculine" },
      { voice: "vesper", note: "British, masculine" },
      { voice: "willow", note: "Irish, feminine" },
      { voice: "stone", note: "Irish, masculine" },
      { voice: "gleam", note: "North American, feminine" },
      { voice: "meridian", note: "North American, masculine" },
      { voice: "beacon", note: "Filipino, masculine" },
      { voice: "delta", note: "Southern U.S., feminine" },
      { voice: "cinder", note: "Southern U.S., masculine" },
    ],
  },
  {
    label: "German",
    voices: [
      { voice: "nuri", note: "feminine" },
      { voice: "juni", note: "feminine" },
      { voice: "flitz", note: "masculine" },
    ],
  },
  {
    label: "French",
    voices: [
      { voice: "brise", note: "feminine" },
      { voice: "sillage", note: "masculine" },
    ],
  },
  {
    label: "Portuguese",
    voices: [
      { voice: "bossa", note: "Brazilian, feminine" },
      { voice: "tempo", note: "Brazilian, masculine" },
    ],
  },
  {
    label: "Japanese",
    voices: [
      { voice: "harema", note: "feminine" },
      { voice: "shida", note: "masculine" },
    ],
  },
  { label: "Korean", voices: [{ voice: "noeul", note: "feminine" }] },
  { label: "Hindi", voices: [{ voice: "nira", note: "feminine" }] },
];

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export const botCallVoiceName = (voice: BotCallVoice) => capitalized(voice);

/** A voice's accent and presentation for a picker row, such as "Irish, masculine". */
export const botCallVoiceNote = (note: string | null) =>
  note === null ? undefined : capitalized(note);

/** "Stone · English, Irish, masculine", or just "Coral" for a voice without a language. */
export function botCallVoiceLabel(voice: BotCallVoice): string {
  for (const group of BOT_CALL_VOICE_GROUPS) {
    const entry = group.voices.find((item) => item.voice === voice);
    if (entry !== undefined && entry.note !== null) {
      return `${botCallVoiceName(voice)} · ${group.label}, ${entry.note}`;
    }
  }
  return botCallVoiceName(voice);
}

/** Applies one change to a bot's call settings. Null means every field is back to its default. */
export function changeBotCallSettings(
  settings: BotCallSettings | null,
  patch: Partial<BotCallSettings>,
): BotCallSettings | null {
  const { voice, language } = { ...settings, ...patch };
  if (voice === undefined && language === undefined) return null;
  return {
    ...(voice === undefined ? {} : { voice }),
    ...(language === undefined ? {} : { language }),
  };
}
