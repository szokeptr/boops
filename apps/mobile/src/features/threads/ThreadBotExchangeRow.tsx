import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { resolveUserMessagePresentation } from "@t3tools/client-runtime/user-message";
import type { EnvironmentId, ProjectAvatar } from "@t3tools/contracts";
import * as Haptics from "expo-haptics";
import { Fragment, type ReactNode } from "react";
import { type ColorValue, Pressable, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import type { ThreadFeedBotExchange, ThreadFeedBotExchangeEntry } from "../../lib/threadActivity";
import { useProject } from "../../state/entities";
import { BotAvatarSlot } from "../bots/BotAvatarSlot";
import { ThreadDisclosureChevron } from "./thread-work-log";

type Peer = ThreadFeedBotExchange["peers"][number];

function usePeerProject(environmentId: EnvironmentId, peer: Peer) {
  return useProject(
    peer.projectId === null ? null : scopeProjectRef(environmentId, peer.projectId),
  );
}

function PeerAvatar(props: { readonly environmentId: EnvironmentId; readonly peer: Peer }) {
  const project = usePeerProject(props.environmentId, props.peer);
  return (
    <BotAvatarSlot
      avatar={project?.avatar ?? null}
      name={project?.title ?? props.peer.name ?? "Bot"}
      status="idle"
      size={16}
    />
  );
}

function PeerName(props: { readonly environmentId: EnvironmentId; readonly peer: Peer }) {
  const project = usePeerProject(props.environmentId, props.peer);
  return <>{project?.title ?? props.peer.name ?? "a bot"}</>;
}

function peerKey(peer: Peer, index: number): string {
  return peer.projectId ?? peer.name ?? String(index);
}

/** What the pill says: the send in flight until the other bot answers, then the talk. */
function exchangeVerb(entries: ReadonlyArray<ThreadFeedBotExchangeEntry>): string {
  if (entries.some((entry) => entry.kind === "message" && entry.message.role === "user")) {
    return "Talked with";
  }
  const last = entries.findLast((entry) => entry.kind === "sent");
  return last?.kind !== "sent"
    ? "Talked with"
    : last.status === "sending"
      ? "Messaging"
      : last.status === "failed"
        ? "Couldn't message"
        : "Messaged";
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
  const verb = exchangeVerb(entry.entries);
  const count = entry.entries.length;
  return (
    <View className="mb-5">
      <View className="items-center">
        <Pressable
          accessibilityRole="button"
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
              <View key={peerKey(peer, index)} style={index > 0 ? { marginLeft: -4 } : undefined}>
                <PeerAvatar environmentId={props.environmentId} peer={peer} />
              </View>
            ))}
          </View>
          <Text numberOfLines={1} className="min-w-0 shrink text-xs text-foreground-muted">
            {verb}{" "}
            <Text className="font-t3-medium text-xs text-foreground">
              {entry.peers.map((peer, index) => (
                <Fragment key={peerKey(peer, index)}>
                  {index === 0 ? null : index === entry.peers.length - 1 ? " and " : ", "}
                  <PeerName environmentId={props.environmentId} peer={peer} />
                </Fragment>
              ))}
            </Text>
            {verb === "Messaging" ? "…" : null}
          </Text>
          {count > 1 ? (
            <Text className="text-xs tabular-nums text-foreground-muted">· {count}</Text>
          ) : null}
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
          {entry.entries.map((item) => {
            const presentation =
              item.kind === "message" ? resolveUserMessagePresentation(item.message) : null;
            const bot =
              item.kind === "message" && item.message.role === "user"
                ? presentation?.bot
                : undefined;
            const text = item.kind === "sent" ? item.text : (presentation?.text ?? "");
            return (
              <View
                key={item.kind === "message" ? item.message.id : item.id}
                className="min-w-0 gap-1"
              >
                <View className="flex-row items-center gap-1.5">
                  {bot === undefined ? (
                    <BotAvatarSlot
                      avatar={props.bot.avatar}
                      name={props.bot.name}
                      status="idle"
                      size={16}
                    />
                  ) : (
                    <PeerAvatar environmentId={props.environmentId} peer={bot} />
                  )}
                  <Text numberOfLines={1} className="shrink font-t3-medium text-xs text-foreground">
                    {bot?.name ?? props.bot.name}
                  </Text>
                  {item.kind === "sent" && item.status !== "sent" ? (
                    <Text className="text-xs text-foreground-muted">
                      {item.status === "sending" ? "Sending…" : "Not delivered"}
                    </Text>
                  ) : null}
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
