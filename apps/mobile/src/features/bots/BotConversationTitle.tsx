import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { deriveBotConversations } from "@t3tools/client-runtime/state/bot-list";
import type { EnvironmentId, ProjectAvatar, ProjectId, ThreadId } from "@t3tools/contracts";
import { useNavigation } from "@react-navigation/native";
import { Pressable, View } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { useProject } from "../../state/entities";
import { environmentThreadShells } from "../../state/threads";
import { useBotCall } from "../bot-call/BotCallProvider";
import { formatCallDuration } from "../bot-call/botCallPresentation";
import { useCallClock } from "../bot-call/callClock";
import { CALL_LIVE_GREEN } from "../bot-call/callColors";
import { isOnCallWith } from "../bot-call/botCallSession";
import { BotAvatarSlot } from "./BotAvatarSlot";

export interface ConversationBot {
  readonly name: string;
  readonly avatar: ProjectAvatar | null;
}

/** The bot heading one of its conversations; `threadId` is null while a new one is written. */
export interface ConversationHeaderBot extends ConversationBot {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId | null;
}

/**
 * Heads a bot's conversation like a DM: the bot, not the project and thread. Tapping it opens
 * the bot's profile, where its conversations live; a dot on the avatar says another needs you.
 */
export function BotConversationTitle(props: { readonly bot: ConversationHeaderBot }) {
  const { bot } = props;
  const project = useProject(scopeProjectRef(bot.environmentId, bot.projectId));
  const threads = useAtomValue(environmentThreadShells.quietThreadShellsAtom);
  const navigation = useNavigation();
  const { call } = useBotCall();
  const onCall = isOnCallWith(call, bot) ? call : null;
  const now = useCallClock(onCall?.state.phase === "live");
  const callLine =
    onCall === null
      ? null
      : onCall.state.phase === "live"
        ? `On a call · ${formatCallDuration((now - (onCall.state.connectedAt ?? now)) / 1000)}`
        : "Calling…";
  const conversations = project === null ? [] : deriveBotConversations({ project, threads });
  const open = conversations.find((conversation) => conversation.threadId === bot.threadId);
  const subtitle =
    bot.threadId === null ? "New conversation" : open && !open.main ? open.title : null;
  const elsewhere = conversations.filter((conversation) => conversation.threadId !== bot.threadId);
  const attention = elsewhere.some((conversation) => conversation.status === "needs-you")
    ? { label: "Another conversation needs you", className: "bg-warning-foreground" }
    : elsewhere.some((conversation) => conversation.unread)
      ? { label: "Unread reply in another conversation", className: "bg-primary" }
      : null;
  return (
    <Pressable
      onPress={() =>
        // navigate, not push: a quick double tap must not open two profiles.
        navigation.navigate("BotProfile", {
          environmentId: String(bot.environmentId),
          projectId: String(bot.projectId),
          ...(bot.threadId === null ? {} : { threadId: String(bot.threadId) }),
        })
      }
      accessibilityRole="button"
      accessibilityHint="Opens the bot's profile"
      accessibilityLabel={[bot.name, onCall === null ? subtitle : "On a call", attention?.label]
        .filter(Boolean)
        .join(", ")}
      hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
      className="min-h-[44px] justify-center active:opacity-70"
    >
      <View className="flex-row items-center gap-2">
        <View>
          <BotAvatarSlot
            avatar={bot.avatar}
            name={bot.name}
            status={open?.status ?? "idle"}
            size={32}
          />
          {attention === null ? null : (
            <View
              className={`absolute -top-0.5 -right-0.5 size-2.5 rounded-full ${attention.className}`}
            />
          )}
        </View>
        <View className="shrink">
          <View className="flex-row items-center gap-1">
            <Text className="shrink font-t3-bold text-base text-foreground" numberOfLines={1}>
              {bot.name}
            </Text>
            {/* Says the pill opens something, now that it leads to the profile. */}
            <SymbolView
              name="chevron.right"
              size={10}
              tintColorClassName="accent-foreground-muted"
              type="monochrome"
            />
          </View>
          {callLine !== null ? (
            <Text
              className="text-xs tabular-nums"
              numberOfLines={1}
              style={{ color: CALL_LIVE_GREEN }}
            >
              {callLine}
            </Text>
          ) : subtitle === null ? null : (
            <Text className="text-xs text-foreground-muted" numberOfLines={1}>
              {subtitle}
            </Text>
          )}
        </View>
      </View>
    </Pressable>
  );
}
