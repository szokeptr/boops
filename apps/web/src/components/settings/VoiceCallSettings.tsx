import {
  type EnvironmentId,
  type SecretReference,
  type SettingsSecretValue,
  isSecretReference,
} from "@t3tools/contracts";
import { ExternalLinkIcon } from "lucide-react";
import { useState } from "react";

import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button, InlineButton } from "../ui/button";
import { SecretSourceInput, useSecretSources } from "./SecretSourceInput";
import { searchableSetting } from "./settingsSearch";
import { SettingsRow, SettingsSection } from "./settingsLayout";

// Older environments send no voice-call settings at all.
const hasKey = (value: SettingsSecretValue | undefined) =>
  typeof value === "string" ? value.trim() !== "" : value !== undefined && isSecretReference(value);

/** The OpenAI API key bot calls run on, and that decides when bots chime in to group chats. */
export function VoiceCallSettings({
  environmentId,
  savedKey,
  readOnly,
}: {
  readonly environmentId: EnvironmentId;
  readonly savedKey: SettingsSecretValue;
  readonly readOnly: boolean;
}) {
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "save the OpenAI API key",
  });
  const secretSources = useSecretSources(environmentId);
  const [draft, setDraft] = useState<string | SecretReference | null>(null);
  const [saving, setSaving] = useState(false);
  const isSaved = hasKey(savedKey);
  const value = draft ?? (isSecretReference(savedKey) ? savedKey : "");
  const submission = typeof value === "string" ? value.trim() : value;

  const save = async (openaiApiKey: SettingsSecretValue) => {
    setSaving(true);
    const result = await updateSettings({
      environmentId,
      input: { patch: { voiceCalls: { openaiApiKey } } },
    });
    setSaving(false);
    if (result._tag === "Success") setDraft(null);
  };

  return (
    <SettingsSection {...searchableSetting("voice-calls")}>
      <SettingsRow
        title="OpenAI API key"
        description={
          <>
            Calls with your bots run on OpenAI&apos;s GPT-Live voice model, and in group chats a
            small OpenAI model reads recent messages to decide when a bot should chime in without an
            @mention. Both are billed to this key.{" "}
            <InlineButton
              render={
                <a
                  href="https://platform.openai.com/api-keys"
                  target="_blank"
                  rel="noreferrer noopener"
                />
              }
            >
              Create a key
              <ExternalLinkIcon aria-hidden className="size-3" />
            </InlineButton>
          </>
        }
      >
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-center"
          onSubmit={(event) => {
            event.preventDefault();
            if (submission !== "") void save(submission);
          }}
        >
          {/* Locked while saving: a successful save clears the draft. */}
          <fieldset disabled={readOnly || saving} className="contents">
            <div className="min-w-0 flex-1">
              <SecretSourceInput
                id={`voice-calls-openai-key-${environmentId}`}
                size="sm"
                aria-label="OpenAI API key"
                placeholder="sk-…"
                configured={isSaved && !isSecretReference(savedKey)}
                value={value}
                sources={secretSources}
                onChange={(event) => setDraft(event.target.value)}
                onSecretChange={(secret) => setDraft(secret ?? "")}
              />
            </div>
            <div className="flex shrink-0 gap-2">
              {isSaved ? (
                <Button size="xs" variant="outline" onClick={() => void save("")}>
                  Remove
                </Button>
              ) : null}
              <Button type="submit" size="xs" disabled={submission === ""}>
                Save
              </Button>
            </div>
          </fieldset>
        </form>
      </SettingsRow>
    </SettingsSection>
  );
}
