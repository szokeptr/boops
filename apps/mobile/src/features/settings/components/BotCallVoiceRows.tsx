import type { MenuAction } from "@react-native-menu/menu";
import {
  BOT_CALL_VOICE_GROUPS,
  botCallVoiceLabel,
  botCallVoiceName,
  botCallVoiceNote,
  changeBotCallSettings,
} from "@t3tools/client-runtime/bot-call";
import {
  BOT_CALL_LANGUAGES,
  BOT_CALL_VOICES,
  type BotCallSettings,
  defaultBotCallVoice,
} from "@t3tools/contracts";

import { Menu } from "../../../components/ui/Menu";
import { SettingsRow } from "./SettingsRow";

const DEFAULT_VOICE = "default-voice";
const MATCH_USER = "match-user";

/** Voice and language for a bot's calls, picked from native menus. Each change keeps the other. */
export function BotCallVoiceRows(props: {
  readonly projectId: string;
  readonly settings: BotCallSettings | null;
  readonly disabled: boolean;
  readonly onChange: (settings: BotCallSettings | null) => void;
}) {
  const defaultVoice = defaultBotCallVoice(props.projectId);
  const voice = props.settings?.voice ?? defaultVoice;
  const language = props.settings?.language ?? null;
  const change = (patch: Partial<BotCallSettings>) =>
    props.onChange(changeBotCallSettings(props.settings, patch));

  const voiceActions: MenuAction[] = [
    {
      id: DEFAULT_VOICE,
      title: `Default (${botCallVoiceName(defaultVoice)})`,
      state: props.settings?.voice === undefined ? "on" : "off",
    },
    ...BOT_CALL_VOICE_GROUPS.map((group): MenuAction => ({
      id: `group:${group.label}`,
      title: group.label,
      subtitle: group.voices.some((item) => item.voice === props.settings?.voice)
        ? botCallVoiceName(voice)
        : undefined,
      subactions: group.voices.map((item): MenuAction => ({
        id: item.voice,
        title: botCallVoiceName(item.voice),
        subtitle: botCallVoiceNote(item.note),
        state: props.settings?.voice === item.voice ? "on" : "off",
      })),
    })),
  ];
  const languageActions: MenuAction[] = [
    { id: MATCH_USER, title: "Match yours", state: language === null ? "on" : "off" },
    ...BOT_CALL_LANGUAGES.map((option): MenuAction => ({
      id: option,
      title: option,
      state: language === option ? "on" : "off",
    })),
  ];

  return (
    <>
      <Menu
        accessible
        accessibilityRole="button"
        accessibilityLabel={`Call voice, ${botCallVoiceName(voice)}`}
        title="Call voice"
        actions={props.disabled ? [] : voiceActions}
        onPressAction={({ nativeEvent }) => {
          const id = nativeEvent.event;
          if (id === DEFAULT_VOICE) change({ voice: undefined });
          else {
            const picked = BOT_CALL_VOICES.find((option) => option === id);
            if (picked !== undefined) change({ voice: picked });
          }
        }}
      >
        <SettingsRow
          icon="speaker.wave.2.fill"
          label="Call voice"
          value={botCallVoiceLabel(voice)}
          disabled={props.disabled}
        />
      </Menu>
      <Menu
        accessible
        accessibilityRole="button"
        accessibilityLabel={`Call language, ${language ?? "match yours"}`}
        title="Call language"
        actions={props.disabled ? [] : languageActions}
        onPressAction={({ nativeEvent }) => {
          const id = nativeEvent.event;
          if (id === MATCH_USER) change({ language: undefined });
          else {
            const picked = BOT_CALL_LANGUAGES.find((option) => option === id);
            if (picked !== undefined) change({ language: picked });
          }
        }}
      >
        <SettingsRow
          icon="text.bubble"
          label="Call language"
          value={language ?? "Match yours"}
          disabled={props.disabled}
        />
      </Menu>
    </>
  );
}
