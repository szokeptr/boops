import { type BotCallWorkEntry, botCallRequestWords } from "@t3tools/client-runtime/bot-call";
import * as Haptics from "expo-haptics";
import type { ReactNode } from "react";
import { Pressable, View, type ColorValue } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";
import { callRecapLabel, callRecapLines } from "./botCallPresentation";

/** A finished call in the conversation: one quiet line that opens to the transcript. */
export function BotCallRecapRow(props: {
  readonly text: string;
  readonly durationSeconds: number | undefined;
  readonly timestampLabel: string;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly bubbleMaxWidth: number | "85%";
  readonly iconSubtleColor: ColorValue;
  /** What the bot did on the call, folded here instead of the conversation. */
  readonly work?: ReadonlyArray<BotCallWorkEntry<{ readonly id: string; readonly text: string }>>;
  readonly renderMarkdown: (text: string) => ReactNode;
}) {
  const label = callRecapLabel(
    props.durationSeconds,
    props.work?.filter((entry) => entry.request !== null).length ?? 0,
  );
  return (
    <View className="mb-5 items-center">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${props.timestampLabel}`}
        accessibilityHint={`Double tap to ${props.expanded ? "hide" : "show"} the transcript.`}
        accessibilityState={{ expanded: props.expanded }}
        hitSlop={8}
        className="max-w-full flex-row items-center gap-1.5 rounded-full bg-subtle px-3 py-1.5 active:opacity-70"
        onPress={() => {
          void Haptics.selectionAsync();
          props.onToggle();
        }}
      >
        <SymbolView
          name="phone.fill"
          size={11}
          tintColor={props.iconSubtleColor}
          type="monochrome"
        />
        <Text className="font-t3-medium text-xs text-foreground-secondary">{label}</Text>
        <Text className="text-xs tabular-nums text-foreground-muted">
          {` · ${props.timestampLabel}`}
        </Text>
        <SymbolView
          name={props.expanded ? "chevron.up" : "chevron.down"}
          size={9}
          tintColor={props.iconSubtleColor}
          type="monochrome"
        />
      </Pressable>
      {props.expanded ? (
        <View
          className="mt-2 gap-2.5 rounded-2xl border border-separator px-3.5 py-3"
          style={{ width: props.bubbleMaxWidth }}
        >
          {callRecapLines(props.text).map((line, index) => (
            // Lines repeat and never reorder; their position is their identity.
            // oxlint-disable-next-line react/no-array-index-key
            <View key={index} className="gap-0.5">
              <Text
                className={cn(
                  "font-t3-medium text-2xs",
                  line.speaker === "user" ? "text-foreground-muted" : "text-foreground-secondary",
                )}
              >
                {line.name}
              </Text>
              <Text selectable className="text-sm leading-5 text-foreground">
                {line.text}
              </Text>
            </View>
          ))}
          {props.work?.map((entry, index) => (
            <View
              key={entry.request?.id ?? `after:${index}`}
              className="gap-1 border-t border-separator pt-2.5"
            >
              <Text className="font-t3-medium text-2xs text-foreground-muted">
                {entry.request === null ? "After the call" : "You asked"}
              </Text>
              {entry.request === null ? null : (
                <Text selectable className="text-sm leading-5 text-foreground">
                  {botCallRequestWords(entry.request.text)}
                </Text>
              )}
              {entry.replies.map((reply) => (
                <View key={reply.id}>{props.renderMarkdown(reply.text)}</View>
              ))}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
