import type { ProjectAvatar } from "@t3tools/contracts";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { BotAvatarSlot } from "./BotAvatarSlot";

export interface ConversationBot {
  readonly name: string;
  readonly avatar: ProjectAvatar | null;
}

/** Heads a bot's main conversation like a DM: the bot, not the project and thread. */
export function BotConversationTitle(props: { readonly bot: ConversationBot }) {
  return (
    <View accessible accessibilityRole="header" className="flex-row items-center gap-2">
      <BotAvatarSlot avatar={props.bot.avatar} name={props.bot.name} status="idle" size={32} />
      <Text className="shrink font-t3-bold text-base text-foreground" numberOfLines={1}>
        {props.bot.name}
      </Text>
    </View>
  );
}
