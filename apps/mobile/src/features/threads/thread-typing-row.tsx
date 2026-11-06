import { useIsFocused } from "@react-navigation/native";
import { useContext, useEffect, useState } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { usePaneRole } from "../../components/ui/Pane";
import { useAppActive, useReduceMotionEnabled } from "../../lib/appState";
import { ThreadMediaVisibleContext } from "./ThreadMarkdownVideo";

const TYPING_LABELS = ["Mulling it over", "On it", "Thinking", "Working on it"] as const;
const TYPING_DOTS = [0, 1, 2] as const;
const TYPING_STEP_MS = 400;

/** A bot's working row reads like a friend typing; the label holds still for the turn. */
export function ThreadTypingRow(props: { readonly startedAt: string; readonly minHeight: number }) {
  const seed = [...props.startedAt].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const label = TYPING_LABELS[seed % TYPING_LABELS.length]!;
  const onScreen = useContext(ThreadMediaVisibleContext);
  const focused = useIsFocused();
  const inSidebar = usePaneRole() === "sidebar";
  const appActive = useAppActive();
  const reduceMotion = useReduceMotionEnabled();
  const stepping = onScreen && (focused || inSidebar) && appActive && !reduceMotion;
  const [lit, setLit] = useState(0);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- steps the lit dot on a timer, only while the row is on screen
  useEffect(() => {
    if (!stepping) return;
    const timer = setInterval(() => setLit((current) => (current + 1) % 3), TYPING_STEP_MS);
    return () => clearInterval(timer);
  }, [stepping]);
  return (
    <View
      accessible
      accessibilityLabel={label}
      className="flex-row items-center gap-2.5 px-1"
      style={{ minHeight: props.minHeight }}
    >
      <View className="flex-row items-center gap-1">
        {TYPING_DOTS.map((dot) => (
          <View
            key={dot}
            className="size-2 rounded-full bg-foreground"
            style={{ opacity: dot === lit ? 1 : 0.3 }}
          />
        ))}
      </View>
      <Text className="text-sm text-foreground-muted">{label}</Text>
    </View>
  );
}
