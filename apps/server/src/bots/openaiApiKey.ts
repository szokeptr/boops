import { isSecretReference } from "@t3tools/contracts";
import type * as SecretResolver from "@t3tools/secret-provider-core/server/SecretResolver";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { requireSettingsSecret } from "../secrets/settingsSecretValue.ts";
import type * as ServerSettings from "../serverSettings.ts";

/**
 * The owner's OpenAI API key, which bot calls and group chats share: the one in Settings, else
 * `OPENAI_API_KEY`. Empty when there is neither.
 */
export const openaiApiKey = Effect.fn("OpenAI.apiKey")(function* (
  settings: ServerSettings.ServerSettingsService["Service"],
  secrets: SecretResolver.SecretResolver["Service"],
) {
  const configured = (yield* settings.getSettings).voiceCalls.openaiApiKey;
  const key =
    isSecretReference(configured) || configured !== ""
      ? yield* requireSettingsSecret(secrets, configured)
      : Option.getOrElse(yield* Config.String("OPENAI_API_KEY").pipe(Config.option), () => "");
  return key.trim();
});
