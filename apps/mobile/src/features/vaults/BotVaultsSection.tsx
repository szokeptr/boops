import { useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import { secretVaultFailureMessage } from "@t3tools/client-runtime/secret-request";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";

import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { secretVaultEnvironment, useSecretVaults } from "../../state/secretVaults";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSection } from "../settings/components/SettingsSection";
import { SettingsSwitchRow } from "../settings/components/SettingsSwitchRow";
import { openSettings } from "../settings/settings-navigation";

/** The environment's vaults, each switched on or off for this bot. */
export function BotVaultsSection(props: {
  readonly bot: EnvironmentProject;
  /** Names the machine when the bot has checkouts on several. */
  readonly environmentLabel?: string | null;
}) {
  const { bot } = props;
  const navigation = useNavigation();
  const { vaults, loaded } = useSecretVaults(bot.environmentId);
  const allowed = useAtomValue(secretVaultEnvironment.setBot.permissionAtom(bot.environmentId));
  const setBot = useAtomCommand(secretVaultEnvironment.setBot, { reportFailure: false });
  return (
    <SettingsSection
      title={props.environmentLabel ? `Vaults on ${props.environmentLabel}` : "Vaults"}
    >
      {!loaded ? (
        <Text className="p-4 text-base text-foreground-muted">Loading vaults…</Text>
      ) : vaults.length === 0 ? (
        <Text className="p-4 text-base text-foreground-muted">
          No vaults yet. When {bot.title} asks for a secret it needs again, you can keep it here.
        </Text>
      ) : (
        vaults.map((vault) => (
          <SettingsSwitchRow
            key={vault.id}
            label={vault.name}
            subtitle={
              vault.entries.length === 0
                ? "Empty"
                : vault.entries.map((entry) => entry.label).join(", ")
            }
            value={vault.projectIds.includes(bot.id)}
            disabled={!allowed}
            onValueChange={async (enabled) => {
              const result = await setBot({
                environmentId: bot.environmentId,
                input: { vaultId: vault.id, projectId: bot.id, enabled },
              });
              if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
                Dialog.alert(
                  enabled ? "Could not turn the vault on" : "Could not turn it off",
                  secretVaultFailureMessage(squashAtomCommandFailure(result)),
                );
              }
            }}
          />
        ))
      )}
      <ListActionRow
        icon={{ ios: "lock.rectangle.stack", android: "lock" }}
        label="Manage vaults"
        onPress={() => openSettings(navigation, "SettingsVaults")}
      />
    </SettingsSection>
  );
}
