import type { BotRow } from "@t3tools/client-runtime/state/bot-list";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useState } from "react";
import { Modal, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { useProjects } from "../../state/entities";
import { BotSharingSection } from "./BotSharingSection";

/** "Share…" from a bot's menu: who chats with this bot, each switched on or off at once. */
function BotShareSheet(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const bot = useProjects().find(
    (project) => project.environmentId === props.environmentId && project.id === props.projectId,
  );
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
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View className="gap-1">
          <Text className="font-t3-bold text-lg text-foreground">Share {bot?.title ?? "bot"}</Text>
          <Text className="font-sans text-sm leading-5 text-foreground-muted">
            People you share with chat with this bot from their own Boops app.
          </Text>
        </View>
        {bot ? (
          <BotSharingSection bot={bot} />
        ) : (
          <Text className="font-sans text-sm text-foreground-muted">
            This bot is no longer available.
          </Text>
        )}
        <Button label="Done" tone="primary" onPress={props.onClose} fullWidth />
      </ScrollView>
    </Modal>
  );
}

/** For a bot list: its rows' "Share…" opens the sheet this returns. */
export function useBotShareSheet() {
  const [target, setTarget] = useState<{
    readonly environmentId: EnvironmentId;
    readonly projectId: ProjectId;
  } | null>(null);
  return {
    onShare: (row: BotRow) =>
      setTarget({ environmentId: row.environmentId, projectId: row.projectId }),
    sheet: target === null ? null : <BotShareSheet {...target} onClose={() => setTarget(null)} />,
  };
}
