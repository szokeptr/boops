import type { ConversationHeaderBot } from "../bots/BotConversationTitle";
import type { ThreadHeaderControlsProps } from "../threads/ThreadHeaderControls";
import { openCallScreen } from "./BotCallPill";
import { useBotCall } from "./BotCallProvider";
import type { ActiveBotCall } from "./botCallSession";
import { CALL_LIVE_GREEN } from "./callColors";

/** Whether `call` is on the line with this conversation's bot. */
export function isOnCallWith(
  call: ActiveBotCall | null,
  bot: Pick<ConversationHeaderBot, "environmentId" | "projectId"> | null,
): boolean {
  return (
    call !== null &&
    bot !== null &&
    call.environmentId === bot.environmentId &&
    call.projectId === bot.projectId &&
    (call.state.phase === "connecting" || call.state.phase === "live")
  );
}

/** The header's call button: calls the bot (the call starts as a pill), or opens its call screen. */
export function useBotCallHeaderAction(
  bot: ConversationHeaderBot | null,
): NonNullable<ThreadHeaderControlsProps["call"]> | null {
  const { call, session } = useBotCall();
  if (bot === null || bot.threadId === null) return null;
  const threadId = bot.threadId;
  if (isOnCallWith(call, bot)) {
    return {
      accessibilityLabel: `Return to call with ${bot.name}`,
      icon: "phone.fill",
      tintColor: CALL_LIVE_GREEN,
      onPress: openCallScreen,
    };
  }
  return {
    accessibilityLabel: `Call ${bot.name}`,
    icon: "phone",
    onPress: () => {
      session.start({
        environmentId: bot.environmentId,
        projectId: bot.projectId,
        threadId,
        botName: bot.name,
        botAvatar: bot.avatar,
      });
    },
  };
}
