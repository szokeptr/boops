import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import { Link } from "@tanstack/react-router";

import { secretVaultEnvironment, useSecretVaults } from "../../state/secretVaults";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsRow, SettingsSection } from "../settings/settingsLayout";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";

/** The environment's vaults, each switched on or off for this bot. */
export function BotVaultsSection(props: {
  readonly bot: EnvironmentProject;
  /** Names the machine when the bot has checkouts on several. */
  readonly environmentLabel?: string | null;
}) {
  const { bot } = props;
  const { vaults, loaded } = useSecretVaults(bot.environmentId);
  const allowed = useAtomValue(secretVaultEnvironment.setBot.permissionAtom(bot.environmentId));
  const setBot = useAtomCommand(secretVaultEnvironment.setBot, { label: "turn vault on for bot" });
  return (
    <SettingsSection
      title={props.environmentLabel ? `Vaults on ${props.environmentLabel}` : "Vaults"}
      headerAction={
        <Button size="xs" variant="ghost" render={<Link to="/settings/vaults" />}>
          Manage vaults
        </Button>
      }
    >
      {!loaded ? (
        <SettingsRow title="Loading vaults…" />
      ) : vaults.length === 0 ? (
        <SettingsRow
          title="No vaults yet."
          description={`When ${bot.title} asks for a secret it needs again, you can keep it here.`}
        />
      ) : (
        vaults.map((vault) => (
          <SettingsRow
            key={vault.id}
            title={vault.name}
            description={
              vault.entries.length === 0
                ? "Empty"
                : vault.entries.map((entry) => entry.label).join(", ")
            }
            control={
              <Switch
                checked={vault.projectIds.includes(bot.id)}
                disabled={!allowed}
                aria-label={`Let ${bot.title} use ${vault.name}`}
                onCheckedChange={(enabled) =>
                  void setBot({
                    environmentId: bot.environmentId,
                    input: { vaultId: vault.id, projectId: bot.id, enabled },
                  })
                }
              />
            }
          />
        ))
      )}
    </SettingsSection>
  );
}
