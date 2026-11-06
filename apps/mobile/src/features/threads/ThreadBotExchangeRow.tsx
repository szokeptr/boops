import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { resolveUserMessagePresentation } from "@t3tools/client-runtime/user-message";
import type { EnvironmentId, ProjectAvatar, ProjectId } from "@t3tools/contracts";
import * as Haptics from "expo-haptics";
import type { ReactNode } from "react";
import { type ColorValue, Pressable, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import type { ThreadFeedBotExchange } from "../../lib/threadActivity";
import { useProject } from "../../state/entities";
import { BotAvatarSlot } from "../bots/BotAvatarSlot";
import { ThreadDisclosureChevron } from "./thread-work-log";

function joinNames(names: ReadonlyArray<string>): string {
  return names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function PeerAvatar(props: {
  readonly environmentId: EnvironmentId;
  readonly name: string;
  readonly projectId: ProjectId | null;
}) {
  const project = useProject(
    props.projectId === null ? null : scopeProjectRef(props.environmentId, props.projectId),
  );
  return (
    <BotAvatarSlot
      avatar={project?.avatar ?? null}
      name={project?.title ?? props.name}
      status="idle"
      size={16}
    />
  );
}

/** Talk between this bot and its parent or child bot, folded to a pill that opens a mini thread. */
export function ThreadBotExchangeRow(props: {
  readonly environmentId: EnvironmentId;
  readonly entry: ThreadFeedBotExchange;
  readonly bot: { readonly name: string; readonly avatar: ProjectAvatar | null };
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly iconSubtleColor: ColorValue;
  readonly renderMarkdown: (text: string) => ReactNode;
}) {
  const { entry, expanded } = props;
  const names = joinNames(entry.peers.map((peer) => peer.name));
  const count = entry.messages.length;
  return (
    <View className="mb-5">
      <View className="items-center">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Talked with ${names}, ${count} ${count === 1 ? "message" : "messages"}`}
          accessibilityState={{ expanded }}
          hitSlop={4}
          className="min-h-9 max-w-full flex-row items-center gap-2 rounded-full border border-border px-3 py-1.5"
          onPress={() => {
            void Haptics.selectionAsync();
            props.onToggle();
          }}
        >
          <View className="flex-row">
            {entry.peers.slice(0, 3).map((peer, index) => (
              <View key={peer.name} style={index > 0 ? { marginLeft: -4 } : undefined}>
                <PeerAvatar
                  environmentId={props.environmentId}
                  name={peer.name}
                  projectId={peer.projectId}
                />
              </View>
            ))}
          </View>
          <Text numberOfLines={1} className="min-w-0 shrink text-xs text-foreground-muted">
            Talked with <Text className="font-t3-medium text-xs text-foreground">{names}</Text>
          </Text>
          <Text className="text-xs tabular-nums text-foreground-muted">· {count}</Text>
          <ThreadDisclosureChevron
            expanded={expanded}
            collapsedDirection="down"
            size={11}
            tintColor={props.iconSubtleColor}
          />
        </Pressable>
      </View>
      {expanded ? (
        <View className="mt-2 gap-3 rounded-2xl border border-border p-3">
          {entry.messages.map((message) => {
            const { bot, text } = resolveUserMessagePresentation(message);
            const peer = message.role === "user" && bot !== undefined ? bot : null;
            return (
              <View key={message.id} className="min-w-0 gap-1">
                <View className="flex-row items-center gap-1.5">
                  {peer === null ? (
                    <BotAvatarSlot
                      avatar={props.bot.avatar}
                      name={props.bot.name}
                      status="idle"
                      size={16}
                    />
                  ) : (
                    <PeerAvatar
                      environmentId={props.environmentId}
                      name={peer.name}
                      projectId={peer.projectId}
                    />
                  )}
                  <Text numberOfLines={1} className="shrink font-t3-medium text-xs text-foreground">
                    {peer?.name ?? props.bot.name}
                  </Text>
                </View>
                <View className="min-w-0 pl-[22px]">{props.renderMarkdown(text)}</View>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}
