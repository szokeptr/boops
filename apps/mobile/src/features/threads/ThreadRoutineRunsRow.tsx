import { SymbolView } from "expo-symbols";
import * as Haptics from "expo-haptics";
import type { ReactNode } from "react";
import { type ColorValue, Pressable, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import type { ThreadFeedRoutineRuns } from "../../lib/threadActivity";
import { ThreadDisclosureChevron } from "./thread-work-log";

/** Earlier runs of a routine, folded to one faded line above its newest run. */
export function ThreadRoutineRunsRow(props: {
  readonly entry: ThreadFeedRoutineRuns;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly iconSubtleColor: ColorValue;
  readonly formatTime: (input: string) => string;
  readonly renderMarkdown: (text: string) => ReactNode;
}) {
  const { entry, expanded } = props;
  const count = entry.runs.length;
  const countLabel = count === 1 ? "1 earlier run" : `${count} earlier runs`;
  return (
    <View className="mb-5">
      <View className="items-center">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Routine: ${entry.routine.name}, ${countLabel}`}
          accessibilityState={{ expanded }}
          hitSlop={8}
          className="max-w-full flex-row items-center gap-1 px-2 py-1 opacity-70"
          onPress={() => {
            void Haptics.selectionAsync();
            props.onToggle();
          }}
        >
          <SymbolView
            name="calendar.badge.clock"
            size={11}
            tintColor={props.iconSubtleColor}
            type="monochrome"
          />
          <Text numberOfLines={1} className="min-w-0 shrink text-xs text-foreground-muted">
            {entry.routine.name}
          </Text>
          <Text className="text-xs tabular-nums text-foreground-muted">{` · ${countLabel}`}</Text>
          <ThreadDisclosureChevron
            expanded={expanded}
            collapsedDirection="down"
            size={10}
            tintColor={props.iconSubtleColor}
          />
        </Pressable>
      </View>
      {expanded ? (
        <View className="mt-2 gap-3 rounded-2xl border border-border p-3">
          {entry.runs.map((run) => (
            <View key={run.wake.id} className="min-w-0 gap-1">
              <Text className="text-xs tabular-nums text-foreground-muted">
                {props.formatTime(run.wake.createdAt)}
              </Text>
              {run.replies.map((reply) => (
                <View key={reply.id} className="min-w-0">
                  {props.renderMarkdown(reply.text)}
                </View>
              ))}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
