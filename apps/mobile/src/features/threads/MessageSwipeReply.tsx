import * as Haptics from "expo-haptics";
import { type ReactNode, useLayoutEffect } from "react";
import { type ColorValue, View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  Extrapolation,
  interpolate,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { SymbolView } from "../../components/ui/AppSymbol";

// Below UIKit's ~10pt pan hysteresis, so the bubble claims the touch before iOS 26's
// swipe-back-from-content does. Back swipe still owns every touch that starts off a bubble.
const ACTIVATE_AT = 8;
const FAIL_OFFSET_Y: [number, number] = [-10, 10];
// The screen edge stays with the system back swipe.
const HIT_SLOP = { left: -12 };
/** The bubble never travels further than this, however far the finger goes. */
const MAX_TRAVEL = 112;
/** Bubble travel at which letting go replies. */
const REPLY_AT = 44;
const ICON_SIZE = 20;
const SETTLE_SPRING = {
  stiffness: 520,
  damping: 44,
  mass: 1,
  reduceMotion: ReduceMotion.System,
} as const;
const POP_SPRING = { stiffness: 600, damping: 18, mass: 0.6 } as const;

function armedHaptic() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
}

/**
 * Drag a message to the right to reply to it. The row follows the finger with growing
 * resistance, the arrow arms with a tick once letting go would reply, and it settles back.
 */
export function MessageSwipeReply(props: {
  readonly onReply: () => void;
  readonly iconColor: string | ColorValue;
  readonly children: ReactNode;
}) {
  const { onReply } = props;
  const travel = useSharedValue(0);
  const armed = useSharedValue(false);
  const pop = useSharedValue(1);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- cancels the Reanimated settle animation on unmount
  useLayoutEffect(
    () => () => {
      cancelAnimation(travel);
      cancelAnimation(pop);
    },
    [travel, pop],
  );

  const gesture = usePanGesture({
    activeOffsetX: ACTIVATE_AT,
    failOffsetX: -ACTIVATE_AT,
    failOffsetY: FAIL_OFFSET_Y,
    hitSlop: HIT_SLOP,
    onUpdate: (event) => {
      const drag = Math.max(0, event.translationX - ACTIVATE_AT);
      // Starts 1:1 with the finger and eases toward MAX_TRAVEL without ever hitting a wall.
      const next = MAX_TRAVEL * (1 - Math.exp(-drag / MAX_TRAVEL));
      travel.set(next);
      const nowArmed = next >= REPLY_AT;
      if (nowArmed !== armed.value) {
        armed.set(nowArmed);
        if (nowArmed) {
          pop.set(withSequence(withTiming(1.3, { duration: 70 }), withSpring(1, POP_SPRING)));
          runOnJS(armedHaptic)();
        }
      }
    },
    onDeactivate: (event) => {
      if (!event.canceled && armed.value) runOnJS(onReply)();
    },
    onFinalize: () => {
      armed.set(false);
      if (travel.value !== 0) travel.set(withSpring(0, SETTLE_SPRING));
    },
  });

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: travel.value }],
  }));
  const iconStyle = useAnimatedStyle(() => {
    const progress = interpolate(travel.value, [0, REPLY_AT], [0, 1], Extrapolation.CLAMP);
    return {
      opacity: progress,
      transform: [
        // Rides in the middle of the gap the bubble opens.
        { translateX: (travel.value - ICON_SIZE) / 2 },
        { scale: (0.5 + 0.5 * progress) * pop.value },
      ],
    };
  });

  return (
    <View>
      <Animated.View
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        className="absolute inset-y-0 left-0 justify-center"
        style={iconStyle}
      >
        <SymbolView name="arrow.uturn.backward" size={ICON_SIZE} tintColor={props.iconColor} />
      </Animated.View>
      <GestureDetector gesture={gesture}>
        <Animated.View
          collapsable={false}
          style={rowStyle}
          accessibilityActions={REPLY_ACTIONS}
          onAccessibilityAction={({ nativeEvent }) => {
            if (nativeEvent.actionName === "reply") onReply();
          }}
        >
          {props.children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const REPLY_ACTIONS = [{ name: "reply", label: "Reply" }];
