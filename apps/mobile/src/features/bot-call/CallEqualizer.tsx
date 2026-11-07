import { memo } from "react";
import { View } from "react-native";
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  withTiming,
} from "react-native-reanimated";

const MIN_HEIGHT = 3;
// Not a spectrum: each reading scatters the real loudness across the bars at random, a little
// taller towards the middle, so it moves like an equalizer.
const centreLift = (count: number) =>
  Array.from({ length: count }, (_, index) => {
    const fromCentre = Math.abs(index - (count - 1) / 2) / ((count - 1) / 2);
    return 1 - fromCentre * 0.45;
  });
const LIFTS = { 8: centreLift(8), 18: centreLift(18) } as const;
const TIMING = { duration: 110 } as const;

type Levels = { readonly user: number; readonly bot: number };

const BarLayer = memo(function BarLayer(props: {
  readonly levels: SharedValue<Levels>;
  readonly side: "user" | "bot";
  readonly lift: number;
  readonly height: number;
  readonly color: string;
  readonly reduceMotion: boolean;
}) {
  const { levels, side, lift, height, reduceMotion } = props;
  const style = useAnimatedStyle(() => {
    const level = levels.value[side];
    const jitter = reduceMotion ? 0.75 : 0.35 + Math.random() * 0.65;
    const scale = (MIN_HEIGHT + level * lift * jitter * (height - MIN_HEIGHT)) / height;
    // Scaling a full-height bar skips layout on every reading.
    return { transform: [{ scaleY: reduceMotion ? scale : withTiming(scale, TIMING) }] };
  });
  return (
    <Animated.View
      className="absolute inset-x-0 rounded-full"
      style={[{ height, backgroundColor: props.color, opacity: side === "bot" ? 1 : 0.5 }, style]}
    />
  );
});

/**
 * The call's sound as equalizer bars in the bot's colour: the bot at full strength over you at
 * half, each layer driven by that side's real loudness.
 */
export function CallEqualizer(props: {
  readonly levels: SharedValue<Levels>;
  readonly color: string;
  readonly height: number;
  readonly bars: keyof typeof LIFTS;
}) {
  const reduceMotion = useReducedMotion();
  const { height } = props;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="flex-row items-center gap-[3px]"
      style={{ height }}
    >
      {LIFTS[props.bars].map((lift, index) => (
        // oxlint-disable-next-line react/no-array-index-key -- a fixed list; its position is the bar
        <View key={index} className="w-[3px]" style={{ height }}>
          <BarLayer
            levels={props.levels}
            side="user"
            lift={lift}
            height={height}
            color={props.color}
            reduceMotion={reduceMotion}
          />
          <BarLayer
            levels={props.levels}
            side="bot"
            lift={lift}
            height={height}
            color={props.color}
            reduceMotion={reduceMotion}
          />
        </View>
      ))}
    </View>
  );
}
