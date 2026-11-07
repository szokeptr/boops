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
  type BotCallLanguage,
  type BotCallSettings,
  type BotCallVoice,
  defaultBotCallVoice,
} from "@t3tools/contracts";

import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { SettingResetButton, SettingsRow } from "./settingsLayout";

const MATCH_USER = "match-user";

const isVoice = (value: unknown): value is BotCallVoice =>
  BOT_CALL_VOICES.some((voice) => voice === value);
const isLanguage = (value: unknown): value is BotCallLanguage =>
  BOT_CALL_LANGUAGES.some((language) => language === value);

/** Voice and language for a bot's calls. Each change keeps the other setting. */
export function BotCallVoiceRows(props: {
  readonly projectId: string;
  readonly settings: BotCallSettings | null;
  readonly disabled: boolean;
  readonly onChange: (settings: BotCallSettings | null) => void;
}) {
  const voice = props.settings?.voice ?? defaultBotCallVoice(props.projectId);
  const language = props.settings?.language ?? null;
  const change = (patch: Partial<BotCallSettings>) =>
    props.onChange(changeBotCallSettings(props.settings, patch));

  return (
    <>
      <SettingsRow
        title="Call voice"
        description={`${botCallVoiceLabel(voice)}. Applies from the next call.`}
        resetAction={
          props.settings?.voice === undefined ? null : (
            <SettingResetButton
              label="call voice"
              disabled={props.disabled}
              onClick={() => change({ voice: undefined })}
            />
          )
        }
        control={
          <Select
            value={voice}
            disabled={props.disabled}
            onValueChange={(next) => {
              if (isVoice(next)) change({ voice: next });
            }}
          >
            <SelectTrigger size="sm" className="w-full sm:w-44" aria-label="Call voice">
              <SelectValue>{botCallVoiceName(voice)}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {BOT_CALL_VOICE_GROUPS.map((group) => (
                <SelectGroup key={group.label}>
                  <SelectGroupLabel>{group.label}</SelectGroupLabel>
                  {group.voices.map((item) => (
                    <SelectItem key={item.voice} value={item.voice}>
                      <span className="flex flex-col">
                        <span>{botCallVoiceName(item.voice)}</span>
                        {item.note === null ? null : (
                          <span className="text-muted-foreground text-xs">
                            {botCallVoiceNote(item.note)}
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      <SettingsRow
        title="Call language"
        description={
          language === null
            ? "Speaks whatever language you speak."
            : `Speaks ${language} unless you ask it to switch.`
        }
        control={
          <Select
            value={language ?? MATCH_USER}
            disabled={props.disabled}
            onValueChange={(next) => {
              if (next === MATCH_USER) change({ language: undefined });
              else if (isLanguage(next)) change({ language: next });
            }}
          >
            <SelectTrigger size="sm" className="w-full sm:w-44" aria-label="Call language">
              <SelectValue>{language ?? "Match yours"}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem value={MATCH_USER}>Match yours</SelectItem>
              {BOT_CALL_LANGUAGES.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
    </>
  );
}
