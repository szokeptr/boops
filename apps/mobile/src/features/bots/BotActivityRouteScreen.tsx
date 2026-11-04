import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { deriveBotActivity, type BotThreadRow } from "@t3tools/client-runtime/state/bot-list";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { LegendList } from "@legendapp/list/react-native";
import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { RelativeTime } from "../../components/RelativeTime";
import { AppBar } from "../../components/ui/AppBar";
import { AppText as Text } from "../../components/ui/AppText";
import { EmptyState } from "../../components/ui/EmptyState";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { cn } from "../../lib/cn";
import { NativeScrollView } from "../../native/NativeScrollViewMarker";
import { useProject } from "../../state/entities";
import { environmentThreadShells } from "../../state/threads";
import { BotStatusLabel, UnreadDot } from "./BotListRow";

type BotActivityRouteScreenProps = StaticScreenProps<{
  readonly environmentId: string;
  readonly projectId: string;
}>;

/** A bot's threads besides its conversation: routine runs and other background work. */
export function BotActivityRouteScreen(props: BotActivityRouteScreenProps) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const environmentId = EnvironmentId.make(props.route.params.environmentId);
  const project = useProject(
    scopeProjectRef(environmentId, ProjectId.make(props.route.params.projectId)),
  );
  const threads = useAtomValue(environmentThreadShells.quietThreadShellsAtom);
  const rows = project === null ? [] : deriveBotActivity({ project, threads });
  const openThread = (row: BotThreadRow) =>
    navigation.dispatch(
      StackActions.push("Thread", {
        environmentId: String(row.environmentId),
        threadId: String(row.threadId),
      }),
    );

  return (
    <View className="flex-1 bg-screen">
      <AppBar
        title={project === null ? "Activity" : `${project.title} · Activity`}
        {...(navigation.canGoBack() ? { onBack: () => navigation.goBack() } : {})}
      />
      <ScreenContent surface="screen">
        {project === null ? (
          <View className="flex-1 items-center justify-center">
            <EmptyState
              title="Bot not found"
              detail="It may have been removed, or its machine is offline."
              variant="plain"
            />
          </View>
        ) : (
          <LegendList
            renderScrollComponent={Platform.OS === "ios" ? NativeScrollView : undefined}
            data={rows}
            keyExtractor={(row) => `${row.environmentId}:${row.threadId}`}
            renderItem={({ item }) => <BotActivityRow row={item} onOpen={openThread} />}
            estimatedItemSize={52}
            recycleItems
            contentInsetAdjustmentBehavior="automatic"
            contentContainerStyle={{
              paddingHorizontal: 8,
              paddingTop: 8,
              paddingBottom: Math.max(insets.bottom, 16) + 16,
            }}
            style={{ flex: 1 }}
            ListEmptyComponent={
              <EmptyState
                title="No activity yet"
                detail="Routine runs and other work this bot does outside its conversation show up here."
                variant="plain"
              />
            }
          />
        )}
      </ScreenContent>
    </View>
  );
}

function BotActivityRow(props: {
  readonly row: BotThreadRow;
  readonly onOpen: (row: BotThreadRow) => void;
}) {
  const { row } = props;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[row.title, row.unread ? "unread" : null]
        .filter((part) => part !== null)
        .join(", ")}
      className="min-h-11 flex-row items-center gap-3 rounded-xl px-3 py-3 active:opacity-70"
      onPress={() => props.onOpen(row)}
    >
      <Text
        numberOfLines={1}
        className={cn(
          "min-w-0 flex-1 text-base text-foreground",
          row.unread ? "font-t3-bold" : "font-t3-medium",
        )}
      >
        {row.title}
      </Text>
      <BotStatusLabel status={row.status} />
      {row.unread ? <UnreadDot /> : null}
      <Text className="text-xs tabular-nums text-foreground-muted">
        <RelativeTime timestamp={row.lastActivityAt} />
      </Text>
    </Pressable>
  );
}
