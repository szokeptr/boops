import { connectionStatusLabel } from "@t3tools/client-runtime/connectors";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import { Link } from "@tanstack/react-router";

import { useConnectorCatalog, useConnectorConnections } from "../../state/connectors";
import { SettingsRow, SettingsSection } from "../settings/settingsLayout";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { ConnectorIcon } from "./ConnectorIcon";
import { useSetBotConnection } from "./useSetBotConnection";

/** The environment's connections, each switched on or off for this bot. */
export function BotConnectorsSection(props: {
  readonly bot: EnvironmentProject;
  /** Names the machine when the bot has checkouts on several. */
  readonly environmentLabel?: string | null;
}) {
  const { bot } = props;
  const { connections, loaded } = useConnectorConnections(bot.environmentId);
  const { entries } = useConnectorCatalog(bot.environmentId);
  const { allowed, set } = useSetBotConnection(bot.environmentId);
  const enabled = new Set<string>(bot.connectionIds ?? []);
  return (
    <SettingsSection
      title={props.environmentLabel ? `Connectors on ${props.environmentLabel}` : "Connectors"}
      headerAction={
        <Button size="xs" variant="ghost" render={<Link to="/settings/connectors" />}>
          Manage connectors
        </Button>
      }
    >
      {!loaded ? (
        <SettingsRow title="Loading connections…" />
      ) : connections.length === 0 ? (
        <SettingsRow
          title="Nothing connected yet."
          description="Connect services like Linear or Notion in Connectors, then turn them on here."
        />
      ) : (
        connections.map((connection) => (
          <SettingsRow
            key={connection.id}
            title={
              <span className="flex min-w-0 items-center gap-2.5">
                <ConnectorIcon
                  name={connection.displayName}
                  iconUrl={entries.find((entry) => entry.id === connection.catalogId)?.iconUrl}
                  className="size-6"
                />
                <span className="min-w-0 truncate">{connection.displayName}</span>
              </span>
            }
            description={
              connection.status === "connected"
                ? `Its tools reach ${bot.title} from the next turn.`
                : `${connectionStatusLabel(connection)}. ${bot.title} can't use it until it's fixed in Connectors.`
            }
            control={
              <Switch
                checked={enabled.has(connection.id)}
                disabled={!allowed}
                aria-label={`Use ${connection.displayName}`}
                onCheckedChange={(checked) =>
                  void set({ projectId: bot.id, connectionId: connection.id, enabled: checked })
                }
              />
            }
          />
        ))
      )}
    </SettingsSection>
  );
}
