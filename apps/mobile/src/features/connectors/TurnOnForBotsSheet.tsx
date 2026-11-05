import type { ConnectorConnection, EnvironmentId } from "@t3tools/contracts";
import { Modal, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { useEnvironmentBots } from "../../state/connectors";
import { SettingsSection } from "../settings/components/SettingsSection";
import { SettingsSwitchRow } from "../settings/components/SettingsSwitchRow";
import { useSetBotConnection } from "./useSetBotConnection";

/** Right after a connection is made: which bots get it. Each switch saves at once. */
export function TurnOnForBotsSheet(props: {
  readonly environmentId: EnvironmentId;
  readonly connection: ConnectorConnection;
  readonly onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const bots = useEnvironmentBots(props.environmentId);
  const { allowed, set } = useSetBotConnection(props.environmentId);
  const { connection } = props;
  return (
    <Modal
      animationType="slide"
      presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"}
      onRequestClose={props.onClose}
    >
      <ScrollView
        className="flex-1 bg-sheet-solid"
        contentContainerClassName="gap-5 p-5"
        contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
      >
        <View className="gap-1">
          <Text className="font-t3-bold text-lg text-foreground">
            {connection.displayName} is connected
          </Text>
          <Text className="font-sans text-sm leading-5 text-foreground-muted">
            Turn it on for the bots that should use it. They get its tools from their next turn.
          </Text>
        </View>
        {bots.length === 0 ? (
          <Text className="font-sans text-sm text-foreground-muted">
            No bots yet. Turn it on from a bot's settings once you have one.
          </Text>
        ) : (
          <SettingsSection title="Bots">
            {bots.map((bot) => (
              <SettingsSwitchRow
                key={bot.id}
                label={bot.title}
                value={bot.connectionIds?.includes(connection.id) === true}
                disabled={!allowed}
                onValueChange={(enabled) =>
                  void set({ projectId: bot.id, connectionId: connection.id, enabled })
                }
              />
            ))}
          </SettingsSection>
        )}
        <Button label="Done" tone="primary" onPress={props.onClose} fullWidth />
      </ScrollView>
    </Modal>
  );
}
