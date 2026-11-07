import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { deriveBotConversations } from "@t3tools/client-runtime/state/bot-list";
import type { EnvironmentId, ProjectAvatar, ProjectId, ThreadId } from "@t3tools/contracts";
import type { MenuAction } from "@react-native-menu/menu";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { Menu } from "../../components/ui/Menu";
import { uuidv4 } from "../../lib/uuid";
import { useProject } from "../../state/entities";
import { environmentThreadShells } from "../../state/threads";
import { useSelectWorkspaceDetail } from "../workspace/useSelectWorkspaceDetail";
import { useBotCall } from "../bot-call/BotCallProvider";
import { formatCallDuration } from "../bot-call/botCallPresentation";
import { useCallClock } from "../bot-call/callClock";
import { CALL_LIVE_GREEN } from "../bot-call/callColors";
import { isOnCallWith } from "../bot-call/useBotCallHeaderAction";
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

const NEW_CONVERSATION = "new-conversation";

/**
 * Heads a bot's conversation like a DM: the bot, not the project and thread. Tapping it lists
 * the bot's conversations and starts a new one; a dot on the avatar says another one needs you.
 */
export function BotConversationTitle(props: { readonly bot: ConversationHeaderBot }) {
  const { bot } = props;
  const project = useProject(scopeProjectRef(bot.environmentId, bot.projectId));
  const threads = useAtomValue(environmentThreadShells.quietThreadShellsAtom);
  const selectDetail = useSelectWorkspaceDetail();
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
  const actions: MenuAction[] = [
    ...conversations.map((conversation): MenuAction => ({
      id: conversation.threadId,
      title: conversation.title,
      state: conversation.threadId === bot.threadId ? "on" : "off",
      ...(conversation.status === "needs-you"
        ? { subtitle: "Needs you" }
        : conversation.unread
          ? { subtitle: "New reply" }
          : {}),
    })),
    {
      id: NEW_CONVERSATION,
      title: "New conversation",
      image: "square.and.pencil",
      state: bot.threadId === null ? "on" : "off",
    },
  ];
  const onPressAction = ({ nativeEvent }: { nativeEvent: { event: string } }) => {
    if (nativeEvent.event === NEW_CONVERSATION) {
      if (bot.threadId === null) return;
      selectDetail({
        name: "Thread",
        params: {
          draft: {
            requestId: uuidv4(),
            environmentId: String(bot.environmentId),
            projectId: String(bot.projectId),
          },
        },
      });
      return;
    }
    if (nativeEvent.event === bot.threadId) return;
    selectDetail({
      name: "Thread",
      params: { environmentId: String(bot.environmentId), threadId: nativeEvent.event },
    });
  };
  return (
    <Menu actions={actions} onPressAction={onPressAction}>
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={[
          `${bot.name} conversations`,
          onCall === null ? subtitle : "On a call",
          attention?.label,
        ]
          .filter(Boolean)
          .join(", ")}
        className="flex-row items-center gap-2"
      >
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
            <SymbolView
              name="chevron.down"
              size={11}
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
    </Menu>
  );
}
