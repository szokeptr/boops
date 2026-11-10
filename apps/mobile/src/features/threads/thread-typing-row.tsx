import { useIsFocused } from "@react-navigation/native";
import { type ReactNode, useEffect, useState } from "react";
import { Animated as NativeAnimated, Easing, View, useAnimatedValue } from "react-native";

import type { ProjectAvatar } from "@t3tools/contracts";

import { AppText as Text } from "../../components/ui/AppText";
import { usePaneRole } from "../../components/ui/Pane";
import { useAppActive, useReduceMotionEnabled } from "../../lib/appState";
import { BotAvatarSlot } from "../bots/BotAvatarSlot";
import { ShimmeringWorkContent } from "./thread-work-log";

const TYPING_LABELS = [
  "On it",
  "Thinking",
  "Mulling it over",
  "Working on it",
  "Piecing it together",
] as const;
const TYPING_LABEL_HOLD_MS = 3200;
const TYPING_DOTS = [0, 1, 2] as const;
const TYPING_CYCLE_MS = 1500;
const TYPING_STAGGER_MS = 160;
// Share of the cycle each dot spends rising and settling; the rest is a pause.
const TYPING_RISE_SHARE = 0.44;
const BOT_FACE_SIZE = 26;

function TypingDot(props: { readonly index: number; readonly progress: NativeAnimated.Value }) {
  const start = (props.index * TYPING_STAGGER_MS) / TYPING_CYCLE_MS;
  const peak = start + TYPING_RISE_SHARE / 2;
  const end = start + TYPING_RISE_SHARE;
  const inputRange = start > 0 ? [0, start, peak, end, 1] : [start, peak, end, 1];
  const bump = props.progress.interpolate({
    inputRange,
    outputRange: start > 0 ? [0, 0, 1, 0, 0] : [0, 1, 0, 0],
    easing: Easing.inOut(Easing.sin),
    extrapolate: "clamp",
  });
  return (
    <NativeAnimated.View
      style={{
        opacity: bump.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
        transform: [
          { translateY: bump.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) },
          { scale: bump.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) },
        ],
      }}
    >
      <View className="size-1.75 rounded-full bg-foreground-muted" />
    </NativeAnimated.View>
  );
}

function FadeIn(props: { readonly animate: boolean; readonly children: ReactNode }) {
  const opacity = useAnimatedValue(props.animate ? 0 : 1);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- one native-driver fade when a new label mounts
  useEffect(() => {
    const fade = NativeAnimated.timing(opacity, {
      toValue: 1,
      duration: 240,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    fade.start();
    return () => fade.stop();
  }, [opacity]);
  return <NativeAnimated.View style={{ opacity }}>{props.children}</NativeAnimated.View>;
}

/**
 * A bot's working row reads like a friend typing, trying a new phrase every few seconds. A group
 * chat names who is typing.
 */
export function ThreadTypingRow(props: {
  readonly startedAt: string;
  readonly minHeight: number;
  readonly name?: string | null;
  /** In a bot's DM, its own working face stands in for the dots. */
  readonly bot?: { readonly name: string; readonly avatar: ProjectAvatar | null } | null;
}) {
  const seed = [...props.startedAt].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const focused = useIsFocused();
  const inSidebar = usePaneRole() === "sidebar";
  const appActive = useAppActive();
  const reduceMotion = useReduceMotionEnabled();
  // Not gated on list viewability: a freshly appended row often never gets a
  // viewability pass, and an off-screen native-driver loop costs no commits.
  const visible = (focused || inSidebar) && appActive;
  const bot = props.bot ?? null;
  const animating = visible && !reduceMotion;
  const waving = animating && bot === null;
  const [step, setStep] = useState(0);
  const label = TYPING_LABELS[(seed + step) % TYPING_LABELS.length]!;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- rotates the label on a timer, only while the screen is showing
  useEffect(() => {
    if (!visible) return;
    const timer = setInterval(() => setStep((current) => current + 1), TYPING_LABEL_HOLD_MS);
    return () => clearInterval(timer);
  }, [visible]);

  // Native driver, not Reanimated: looping Reanimated commits can starve React's.
  // See docs/internals/performance-regressions.md.
  const progress = useAnimatedValue(0);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- runs the native-driver wave only while the screen is showing
  useEffect(() => {
    progress.setValue(0);
    if (!waving) return;
    const loop = NativeAnimated.loop(
      NativeAnimated.timing(progress, {
        toValue: 1,
        duration: TYPING_CYCLE_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [waving, progress]);

  return (
    <View
      accessible
      accessibilityLabel={props.name ? `${props.name} working` : "Working"}
      className="flex-row items-center gap-2.5 px-1"
      style={{ minHeight: props.minHeight }}
    >
      {bot ? (
        <BotAvatarSlot
          avatar={bot.avatar}
          name={bot.name}
          status="working"
          size={BOT_FACE_SIZE}
          animate={animating}
        />
      ) : (
        <View className="flex-row items-center gap-1.25">
          {TYPING_DOTS.map((dot) => (
            <TypingDot key={dot} index={dot} progress={progress} />
          ))}
        </View>
      )}
      <FadeIn key={label} animate={step > 0 && !reduceMotion}>
        <ShimmeringWorkContent
          className="flex-none"
          compact
          icon="brain"
          iconSubtleColor="transparent"
          label={label}
          showIcon={false}
        />
      </FadeIn>
      {props.name ? (
        <Text numberOfLines={1} className="min-w-0 shrink text-sm text-foreground-muted">
          · {props.name}
        </Text>
      ) : null}
    </View>
  );
}
