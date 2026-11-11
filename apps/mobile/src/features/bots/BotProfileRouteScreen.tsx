import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  deriveBotActivity,
  deriveBotConversations,
  type BotConversationTab,
} from "@t3tools/client-runtime/state/bot-list";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { RelativeTime } from "../../components/RelativeTime";
import { AppBar } from "../../components/ui/AppBar";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { EmptyState } from "../../components/ui/EmptyState";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { uuidv4 } from "../../lib/uuid";
import { useProject } from "../../state/entities";
import { environmentThreadShells } from "../../state/threads";
import { ListRow, ListSection } from "../projects/AddProjectScreen";
import { useSelectWorkspaceDetail } from "../workspace/useSelectWorkspaceDetail";
import { BotAvatarSlot } from "./BotAvatarSlot";
import { BotStatusLabel, UnreadDot } from "./BotListRow";

type BotProfileRouteScreenProps = StaticScreenProps<{
  readonly environmentId: string;
  readonly projectId: string;
  /** The conversation the profile was opened from; tapping it goes back. */
  readonly threadId?: string;
}>;

const HERO_SIZE = 120;
const ROW_ICON_SIZE = Platform.OS === "android" ? 24 : 17;

function RowIcon(props: { readonly name: Parameters<typeof SymbolView>[0]["name"] }) {
  return <SymbolView name={props.name} size={ROW_ICON_SIZE} tintColorClassName="accent-icon" />;
}

function Chevron() {
  return (
    <SymbolView
      name="chevron.right"
      size={13}
      tintColorClassName="accent-chevron"
      type="monochrome"
    />
  );
}

function ConversationTrailing(props: {
  readonly conversation: BotConversationTab;
  readonly current: boolean;
}) {
  return (
    <View className="flex-row items-center gap-2">
      <BotStatusLabel status={props.conversation.status} />
      {props.conversation.unread ? <UnreadDot /> : null}
      <Text className="text-[13px] tabular-nums text-foreground-muted">
        <RelativeTime timestamp={props.conversation.lastActivityAt} />
      </Text>
      {props.current ? (
        <SymbolView name="checkmark" size={14} tintColorClassName="accent-icon" type="monochrome" />
      ) : (
        <Chevron />
      )}
    </View>
  );
}

/** A bot's profile, opened from its conversation header: who it is, its talks, and its settings. */
export function BotProfileRouteScreen(props: BotProfileRouteScreenProps) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const environmentId = EnvironmentId.make(props.route.params.environmentId);
  const projectId = ProjectId.make(props.route.params.projectId);
  const project = useProject(scopeProjectRef(environmentId, projectId));
  const threads = useAtomValue(environmentThreadShells.quietThreadShellsAtom);
  const conversations = project === null ? [] : deriveBotConversations({ project, threads });
  const activityCount = project === null ? 0 : deriveBotActivity({ project, threads }).length;
  const status = conversations.find((conversation) => conversation.main)?.status ?? "idle";
  // The workspace's own detail path, so switching conversations never stacks duplicates.
  const selectDetail = useSelectWorkspaceDetail();
  const currentThreadId = props.route.params.threadId ?? null;
  const openThread = (threadId: string) => {
    if (threadId === currentThreadId && navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    selectDetail({ name: "Thread", params: { environmentId: String(environmentId), threadId } });
  };
  const openSettings = () =>
    // Pushed rather than opened in the Settings tab, so Back returns here.
    navigation.dispatch(
      StackActions.push("SettingsProjectOverview", {
        environmentId: String(environmentId),
        projectId: String(projectId),
      }),
    );
  const startConversation = () =>
    selectDetail({
      name: "Thread",
      params: {
        draft: {
          requestId: uuidv4(),
          environmentId: String(environmentId),
          projectId: String(projectId),
        },
      },
    });

  return (
    <View className="flex-1 bg-screen">
      <AppBar title="" {...(navigation.canGoBack() ? { onBack: () => navigation.goBack() } : {})} />
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
          <ScrollView
            contentInsetAdjustmentBehavior="automatic"
            contentContainerStyle={{
              paddingHorizontal: 20,
              paddingTop: 8,
              paddingBottom: Math.max(insets.bottom, 18) + 18,
              gap: 10,
            }}
          >
            <View className="items-center gap-3 pb-4">
              <BotAvatarSlot
                avatar={project.avatar ?? null}
                name={project.title}
                status={status}
                size={HERO_SIZE}
              />
              <Text
                accessibilityRole="header"
                className="text-center font-t3-bold text-[26px] text-foreground"
                numberOfLines={2}
              >
                {project.title}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Edit ${project.title}`}
                onPress={openSettings}
                hitSlop={4}
                className="min-h-[36px] justify-center rounded-full bg-subtle px-5 active:opacity-70"
              >
                <Text className="font-t3-medium text-[15px] text-foreground">Edit</Text>
              </Pressable>
            </View>
            <ListSection>
              {conversations.map((conversation, index) => (
                <ListRow
                  key={conversation.threadId}
                  title={conversation.main ? "Main conversation" : conversation.title}
                  titleWeight="regular"
                  current={conversation.threadId === currentThreadId}
                  icon={<RowIcon name={conversation.main ? "star" : "bubble.left"} />}
                  isFirst={index === 0}
                  right={
                    <ConversationTrailing
                      conversation={conversation}
                      current={conversation.threadId === currentThreadId}
                    />
                  }
                  onPress={() => openThread(String(conversation.threadId))}
                />
              ))}
              <ListRow
                title="New conversation"
                titleWeight="regular"
                icon={<RowIcon name="square.and.pencil" />}
                isFirst={conversations.length === 0}
                onPress={startConversation}
              />
            </ListSection>
            <View className="h-2" />
            <ListSection>
              <ListRow
                title="Activity"
                titleWeight="regular"
                subtitle={activityCount === 0 ? "Routine runs and background work" : null}
                icon={<RowIcon name="clock" />}
                isFirst
                {...(activityCount > 0
                  ? {
                      right: (
                        <View className="flex-row items-center gap-2">
                          <Text className="text-[15px] tabular-nums text-foreground-muted">
                            {activityCount}
                          </Text>
                          <Chevron />
                        </View>
                      ),
                    }
                  : {})}
                onPress={() =>
                  navigation.dispatch(
                    StackActions.push("BotActivity", {
                      environmentId: String(environmentId),
                      projectId: String(projectId),
                    }),
                  )
                }
              />
              <ListRow
                title="Bot settings"
                titleWeight="regular"
                icon={<RowIcon name="gearshape" />}
                onPress={openSettings}
              />
            </ListSection>
          </ScrollView>
        )}
      </ScreenContent>
    </View>
  );
}
