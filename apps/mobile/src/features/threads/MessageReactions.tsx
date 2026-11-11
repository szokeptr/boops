import {
  firstEmoji,
  groupMessageReactions,
  MESSAGE_QUICK_REACTIONS,
  messageReactionLabel,
  MORE_REACTION_EMOJIS,
} from "@t3tools/client-runtime/message-reactions";
import type { MessageId, OrchestrationV2MessageReaction } from "@t3tools/contracts";
import { BlurView } from "expo-blur";
import { type ComponentRef, type ReactNode, useRef, useState } from "react";
import {
  type ColorValue,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, { FadeIn, LayoutAnimationConfig, ZoomIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { type AppSymbolViewProps, SymbolView } from "../../components/ui/AppSymbol";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";

export type MessageReactionAlign = "left" | "right";

export interface MessageReactionAccent {
  readonly background: string;
  readonly foreground: string;
}

export interface MessageReactionAction {
  readonly id: string;
  readonly title: string;
  readonly icon: AppSymbolViewProps["name"];
  readonly onPress: () => void;
}

export interface MessageReactionTarget {
  readonly messageId: MessageId;
  /** The bubble's frame in window coordinates. */
  readonly rect: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly align: MessageReactionAlign;
  /** A copy of the bubble, lifted above the dimmed feed. */
  readonly bubble: ReactNode;
  readonly current: string | null;
  /** What the server had when the overlay opened; a pending choice holds only while it lasts. */
  readonly serverReactions: ReadonlyArray<OrchestrationV2MessageReaction> | undefined;
  readonly actions: ReadonlyArray<MessageReactionAction>;
}

const BADGE_HEIGHT = 26;
const BADGE_OUTLINE = 2;
const BADGE_OVERLAP = 4;
/** Room a reacted bubble keeps above it so its badges clear the row before. */
export const MESSAGE_REACTION_BADGE_CLEARANCE = 18;

/** The tail's two dots, as size and distance past the badge's outer bottom corner. */
const TAIL_DOTS = [
  { size: 9, reach: 2 },
  { size: 4, reach: 6 },
] as const;

/**
 * Tapbacks pinned over the bubble's top corner: right for the bot's bubbles, left for the user's.
 * Each emoji is a small bubble; they overlap toward the corner with the newest in front, and that
 * one carries the tail.
 */
export function MessageReactionBadges(props: {
  readonly reactions: ReadonlyArray<OrchestrationV2MessageReaction> | undefined;
  readonly align: MessageReactionAlign;
  readonly accent: MessageReactionAccent;
  readonly outlineColor: string;
  /** The incoming bubble's colour; a badge that is not yours is a step off it. */
  readonly surfaceColor: string;
  /** Absent in read-only feeds. */
  readonly onPress?: ((emoji: string, mine: boolean) => void) | undefined;
}) {
  const groups = groupMessageReactions(props.reactions);
  const outer = props.align === "left" ? "right" : "left";
  return (
    // Badges present when the bubble mounts stay still; only one added afterwards pops in.
    <LayoutAnimationConfig skipEntering>
      {groups.length === 0 ? null : (
        <View
          className="absolute"
          style={{
            top: -MESSAGE_REACTION_BADGE_CLEARANCE,
            [outer]: -14,
            flexDirection: outer === "right" ? "row" : "row-reverse",
          }}
        >
          {groups.map((group, index) => {
            const fill = group.mine ? props.accent.background : props.surfaceColor;
            const front = index === groups.length - 1;
            return (
              <Animated.View
                key={group.emoji}
                entering={ZoomIn.springify().damping(13).stiffness(260)}
                style={[
                  { zIndex: index },
                  index === 0
                    ? null
                    : outer === "right"
                      ? { marginLeft: -BADGE_OVERLAP - BADGE_OUTLINE }
                      : { marginRight: -BADGE_OVERLAP - BADGE_OUTLINE },
                ]}
              >
                {front
                  ? TAIL_DOTS.map((dot) => (
                      <View
                        key={dot.size}
                        className="absolute rounded-full"
                        style={{
                          width: dot.size + BADGE_OUTLINE * 2,
                          height: dot.size + BADGE_OUTLINE * 2,
                          bottom: -dot.reach,
                          [outer]: -dot.reach,
                          backgroundColor: props.outlineColor,
                        }}
                      />
                    ))
                  : null}
                <Pressable
                  accessibilityRole={props.onPress ? "button" : "text"}
                  accessibilityLabel={messageReactionLabel(group)}
                  accessibilityHint={
                    props.onPress
                      ? group.mine
                        ? "Removes your reaction"
                        : "Opens reactions"
                      : undefined
                  }
                  disabled={!props.onPress}
                  hitSlop={6}
                  onPress={() => props.onPress?.(group.emoji, group.mine)}
                  className="flex-row items-center justify-center gap-0.5 overflow-hidden rounded-full px-1"
                  style={{
                    minWidth: BADGE_HEIGHT + BADGE_OUTLINE * 2,
                    height: BADGE_HEIGHT + BADGE_OUTLINE * 2,
                    borderWidth: BADGE_OUTLINE,
                    borderColor: props.outlineColor,
                    backgroundColor: fill,
                  }}
                >
                  {group.mine ? null : <BadgeShade />}
                  <Text style={{ fontSize: 14, lineHeight: 18 }}>{group.emoji}</Text>
                  {group.count > 1 ? (
                    <Text
                      className="pr-0.5 font-t3-medium text-2xs tabular-nums text-foreground"
                      style={group.mine ? { color: props.accent.foreground } : undefined}
                    >
                      {group.count}
                    </Text>
                  ) : null}
                </Pressable>
                {front
                  ? TAIL_DOTS.map((dot) => (
                      <View
                        key={dot.size}
                        pointerEvents="none"
                        className="absolute overflow-hidden rounded-full"
                        style={{
                          width: dot.size,
                          height: dot.size,
                          bottom: BADGE_OUTLINE - dot.reach,
                          [outer]: BADGE_OUTLINE - dot.reach,
                          backgroundColor: fill,
                        }}
                      >
                        {group.mine ? null : <BadgeShade />}
                      </View>
                    ))
                  : null}
              </Animated.View>
            );
          })}
        </View>
      )}
    </LayoutAnimationConfig>
  );
}

/** Darkens (or, on a dark theme, lightens) the bubble colour so a badge reads against its bubble. */
function BadgeShade() {
  return (
    <View
      pointerEvents="none"
      className="absolute inset-0 bg-foreground"
      style={{ opacity: 0.14 }}
    />
  );
}

const EDGE = 12;
const GAP = 10;
const REACTION_SIZE = 40;
const PILL_PADDING = 6;
const PILL_HEIGHT = REACTION_SIZE + PILL_PADDING * 2;
const PILL_WIDTH = (MESSAGE_QUICK_REACTIONS.length + 1) * REACTION_SIZE + PILL_PADDING * 2;
const MENU_ROW_HEIGHT = 44;
const MENU_WIDTH = 220;
const GRID_COLUMNS = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/**
 * Long-press on a bubble: the feed dims, the bubble lifts with the reactions above it and its
 * actions below, shifted to stay on screen.
 */
export function MessageReactionOverlay(props: {
  readonly target: MessageReactionTarget;
  readonly accent: MessageReactionAccent;
  readonly iconColor: ColorValue;
  readonly onChoose: (target: MessageReactionTarget, emoji: string) => void;
  readonly onClose: () => void;
}) {
  const { target, onClose } = props;
  const { themeAppearance } = useAppearancePreferences();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [moreOpen, setMoreOpen] = useState(false);
  const typedInput = useRef<ComponentRef<typeof TextInput>>(null);

  const choose = (emoji: string) => props.onChoose(target, emoji);
  const menuHeight = target.actions.length * MENU_ROW_HEIGHT;
  const topLimit = insets.top + EDGE + PILL_HEIGHT + GAP;
  const bottomLimit = windowHeight - insets.bottom - EDGE - (menuHeight > 0 ? menuHeight + GAP : 0);
  const bubbleHeight = Math.min(
    target.rect.height,
    Math.max(REACTION_SIZE * 2, bottomLimit - topLimit),
  );
  const bubbleTop = Math.max(topLimit, Math.min(target.rect.y, bottomLimit - bubbleHeight));
  const sideLeft = (width: number) =>
    clamp(
      target.align === "left" ? target.rect.x : target.rect.x + target.rect.width - width,
      EDGE,
      windowWidth - EDGE - width,
    );
  const gridWidth = Math.min(windowWidth - EDGE * 2, GRID_COLUMNS * REACTION_SIZE + 16);

  return (
    <Modal transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close reactions"
        onPress={onClose}
        style={StyleSheet.absoluteFill}
      >
        {Platform.OS === "ios" ? (
          <BlurView
            intensity={24}
            tint={themeAppearance === "dark" ? "dark" : "default"}
            style={StyleSheet.absoluteFill}
          />
        ) : null}
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: themeAppearance === "dark" ? "#00000066" : "#00000033" },
          ]}
        />
      </Pressable>

      {moreOpen ? (
        <Animated.View
          entering={FadeIn.duration(140)}
          className="absolute gap-2 rounded-[22px] bg-sheet-solid p-2"
          style={{ top: insets.top + EDGE, left: (windowWidth - gridWidth) / 2, width: gridWidth }}
        >
          <TextInput
            ref={typedInput}
            autoFocus
            autoCorrect={false}
            onChangeText={(text) => {
              const emoji = firstEmoji(text);
              if (emoji !== null) choose(emoji);
              else typedInput.current?.clear();
            }}
            accessibilityLabel="Type any emoji"
            placeholder="Type any emoji"
            className="h-10 rounded-full bg-subtle-strong px-4 text-base text-foreground"
          />
          <View className="flex-row flex-wrap">
            {MORE_REACTION_EMOJIS.map((emoji) => (
              <ReactionButton
                key={emoji}
                emoji={emoji}
                size={(gridWidth - 16) / GRID_COLUMNS}
                selected={emoji === target.current}
                accent={props.accent}
                onPress={() => choose(emoji)}
              />
            ))}
          </View>
        </Animated.View>
      ) : (
        <>
          <Animated.View
            entering={ZoomIn.duration(160)}
            className="absolute flex-row rounded-full bg-sheet-solid"
            style={{
              top: bubbleTop - GAP - PILL_HEIGHT,
              left: sideLeft(PILL_WIDTH),
              padding: PILL_PADDING,
            }}
          >
            {MESSAGE_QUICK_REACTIONS.map((emoji) => (
              <ReactionButton
                key={emoji}
                emoji={emoji}
                size={REACTION_SIZE}
                selected={emoji === target.current}
                accent={props.accent}
                onPress={() => choose(emoji)}
              />
            ))}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="More reactions"
              onPress={() => setMoreOpen(true)}
              className="items-center justify-center rounded-full"
              style={{ width: REACTION_SIZE, height: REACTION_SIZE }}
            >
              <SymbolView name="face.smiling" size={22} tintColor={props.iconColor} />
            </Pressable>
          </Animated.View>

          <View
            pointerEvents="none"
            className="absolute overflow-hidden"
            style={{
              top: bubbleTop,
              left: target.rect.x,
              width: target.rect.width,
              height: bubbleHeight,
            }}
          >
            {target.bubble}
          </View>

          {target.actions.length > 0 ? (
            <Animated.View
              entering={FadeIn.duration(160)}
              className="absolute overflow-hidden rounded-[14px] bg-sheet-solid"
              style={{
                top: bubbleTop + bubbleHeight + GAP,
                left: sideLeft(MENU_WIDTH),
                width: MENU_WIDTH,
              }}
            >
              {target.actions.map((action, index) => (
                <Pressable
                  key={action.id}
                  accessibilityRole="button"
                  onPress={() => {
                    onClose();
                    action.onPress();
                  }}
                  className={
                    index === 0
                      ? "flex-row items-center justify-between px-4 active:bg-subtle"
                      : "flex-row items-center justify-between border-t border-separator px-4 active:bg-subtle"
                  }
                  style={{ height: MENU_ROW_HEIGHT }}
                >
                  <Text className="text-base text-foreground">{action.title}</Text>
                  <SymbolView name={action.icon} size={17} tintColor={props.iconColor} />
                </Pressable>
              ))}
            </Animated.View>
          ) : null}
        </>
      )}
    </Modal>
  );
}

function ReactionButton(props: {
  readonly emoji: string;
  readonly size: number;
  readonly selected: boolean;
  readonly accent: MessageReactionAccent;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.selected ? `Remove ${props.emoji}` : `React with ${props.emoji}`}
      accessibilityState={{ selected: props.selected }}
      onPress={props.onPress}
      className="items-center justify-center rounded-full"
      style={{
        width: props.size,
        height: props.size,
        backgroundColor: props.selected ? props.accent.background : undefined,
      }}
    >
      <Text style={{ fontSize: props.size * 0.55, lineHeight: props.size * 0.7 }}>
        {props.emoji}
      </Text>
    </Pressable>
  );
}
