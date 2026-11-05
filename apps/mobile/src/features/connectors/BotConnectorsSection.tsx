import { connectionStatusLabel } from "@t3tools/client-runtime/connectors";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { useNavigation } from "@react-navigation/native";

import { AppText as Text } from "../../components/ui/AppText";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { useConnectorConnections } from "../../state/connectors";
import { SettingsSection } from "../settings/components/SettingsSection";
import { SettingsSwitchRow } from "../settings/components/SettingsSwitchRow";
import { openSettings } from "../settings/settings-navigation";
import { useSetBotConnection } from "./useSetBotConnection";

/** The environment's connections, each switched on or off for this bot. */
export function BotConnectorsSection(props: {
  readonly bot: EnvironmentProject;
  /** Names the machine when the bot has checkouts on several. */
  readonly environmentLabel?: string | null;
}) {
  const { bot } = props;
  const navigation = useNavigation();
  const { connections, loaded } = useConnectorConnections(bot.environmentId);
  const { allowed, set } = useSetBotConnection(bot.environmentId);
  const enabled = new Set<string>(bot.connectionIds ?? []);
  return (
    <SettingsSection
      title={props.environmentLabel ? `Connectors on ${props.environmentLabel}` : "Connectors"}
    >
      {!loaded ? (
        <Text className="p-4 text-base text-foreground-muted">Loading connections…</Text>
      ) : connections.length === 0 ? (
        <Text className="p-4 text-base text-foreground-muted">
          Nothing connected yet. Connect services like Linear or Notion, then turn them on here.
        </Text>
      ) : (
        connections.map((connection) => (
          <SettingsSwitchRow
            key={connection.id}
            label={connection.displayName}
            subtitle={
              connection.status === "connected"
                ? `Its tools reach ${bot.title} from the next turn.`
                : `${connectionStatusLabel(connection)}. Fix it in Connectors.`
            }
            value={enabled.has(connection.id)}
            disabled={!allowed}
            onValueChange={(on) =>
              void set({ projectId: bot.id, connectionId: connection.id, enabled: on })
            }
          />
        ))
      )}
      <ListActionRow
        icon="cable.connector"
        label="Manage connectors"
        onPress={() => openSettings(navigation, "SettingsConnectors")}
      />
    </SettingsSection>
  );
}
