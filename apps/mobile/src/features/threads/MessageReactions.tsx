import {
  firstEmoji,
  groupMessageReactions,
  MESSAGE_QUICK_REACTIONS,
  messageReactionLabel,
  MORE_REACTION_EMOJIS,
} from "@t3tools/client-runtime/message-reactions";
import type { MessageId, OrchestrationV2MessageReaction } from "@t3tools/contracts";
import { type ComponentRef, useRef, useState } from "react";
import { type ColorValue, Platform, Pressable, useWindowDimensions, View } from "react-native";
import Animated, { LayoutAnimationConfig, ZoomIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FormSheet } from "react-native-screens";
import { useResolveClassNames } from "uniwind";

import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { type AppSymbolViewProps, SymbolView } from "../../components/ui/AppSymbol";

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

const SHEET_PADDING = 20;
const GRID_GAP = 12;
const GRID_COLUMNS = 6;
const MAX_REACTION_SIZE = 56;
const ACTION_ROW_HEIGHT = 52;
// The quick reactions, then a few more, filling two rows with the "more" button last.
const SHEET_REACTIONS = [...MESSAGE_QUICK_REACTIONS, "🎉", "🔥", "👀", "🙏", "💯"];
const MORE_SHEET_REACTIONS = MORE_REACTION_EMOJIS.filter(
  (emoji) => !SHEET_REACTIONS.includes(emoji),
);

/**
 * Long-press on a bubble opens this drawer: a grid of reactions, any emoji behind the last
 * button, and the bubble's actions below. Each opening is a fresh native sheet.
 */
export function MessageReactionSheet(props: {
  readonly target: MessageReactionTarget | null;
  readonly accent: MessageReactionAccent;
  readonly iconColor: ColorValue;
  readonly onChoose: (target: MessageReactionTarget, emoji: string) => void;
  readonly onClose: () => void;
}) {
  const containerStyle = useResolveClassNames(Platform.OS === "android" ? "bg-header" : "bg-sheet");
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const [moreOpen, setMoreOpen] = useState(false);
  const typedInput = useRef<ComponentRef<typeof TextInput>>(null);
  // Keeps the last target drawn while the sheet slides away.
  const [presented, setPresented] = useState({
    target: props.target,
    open: props.target !== null,
    session: 0,
  });
  if (props.target !== null && props.target !== presented.target) {
    setPresented({
      target: props.target,
      open: true,
      session: presented.open ? presented.session : presented.session + 1,
    });
    setMoreOpen(false);
  } else if (props.target === null && presented.open) {
    setPresented({ ...presented, open: false });
  }
  // An action may present another screen, so it waits until the sheet is gone.
  const afterClose = useRef<(() => void) | null>(null);
  const dismissed = () => {
    setPresented((current) => ({ ...current, target: null }));
    const then = afterClose.current;
    afterClose.current = null;
    then?.();
  };
  const target = presented.target;
  if (target === null) return null;
  const choose = (emoji: string) => props.onChoose(target, emoji);
  const size = Math.min(
    MAX_REACTION_SIZE,
    (Math.min(windowWidth, 500) - SHEET_PADDING * 2 - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS,
  );

  return (
    <FormSheet
      key={presented.session}
      isOpen={presented.open}
      detents="fitToContents"
      prefersGrabberVisible
      preferredCornerRadius={Platform.OS === "android" ? 28 : undefined}
      nativeContainerStyle={containerStyle}
      onDismiss={dismissed}
      onNativeDismiss={() => {
        props.onClose();
        dismissed();
      }}
    >
      <View
        collapsable={false}
        className="gap-5 bg-sheet"
        style={{
          paddingHorizontal: SHEET_PADDING,
          paddingTop: SHEET_PADDING + 8,
          paddingBottom: Math.max(insets.bottom, SHEET_PADDING),
        }}
      >
        <View className="flex-row flex-wrap justify-center" style={{ gap: GRID_GAP }}>
          {SHEET_REACTIONS.map((emoji) => (
            <ReactionButton
              key={emoji}
              emoji={emoji}
              size={size}
              selected={emoji === target.current}
              accent={props.accent}
              onPress={() => choose(emoji)}
            />
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="More reactions"
            accessibilityState={{ expanded: moreOpen }}
            onPress={() => setMoreOpen((open) => !open)}
            className="items-center justify-center rounded-full bg-foreground/10 active:opacity-70"
            style={{ width: size, height: size }}
          >
            <SymbolView
              name={moreOpen ? "chevron.up" : "face.smiling"}
              size={size * 0.42}
              tintColor={props.iconColor}
            />
          </Pressable>
        </View>

        {moreOpen ? (
          <View className="gap-3">
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
              className="h-11 rounded-full bg-foreground/10 px-4 text-base text-foreground"
            />
            <View className="flex-row flex-wrap justify-between" style={{ rowGap: 4 }}>
              {MORE_SHEET_REACTIONS.map((emoji) => (
                <ReactionButton
                  key={emoji}
                  emoji={emoji}
                  size={size * 0.8}
                  selected={emoji === target.current}
                  accent={props.accent}
                  onPress={() => choose(emoji)}
                />
              ))}
            </View>
          </View>
        ) : null}

        {target.actions.length > 0 ? (
          <View className="overflow-hidden rounded-[18px] bg-foreground/[0.07]">
            {target.actions.map((action, index) => (
              <Pressable
                key={action.id}
                accessibilityRole="button"
                onPress={() => {
                  afterClose.current = action.onPress;
                  props.onClose();
                }}
                className="flex-row items-center gap-4 px-4 active:bg-foreground/10"
                style={{ height: ACTION_ROW_HEIGHT }}
              >
                <SymbolView name={action.icon} size={20} tintColor={props.iconColor} />
                <View
                  className={
                    index === 0
                      ? "h-full flex-1 justify-center"
                      : "h-full flex-1 justify-center border-t border-foreground/10"
                  }
                >
                  <Text className="text-[17px] text-foreground">{action.title}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    </FormSheet>
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
      className="items-center justify-center rounded-full bg-foreground/10 active:opacity-70"
      // An inline `undefined` background would override the class's circle.
      style={
        props.selected
          ? { width: props.size, height: props.size, backgroundColor: props.accent.background }
          : { width: props.size, height: props.size }
      }
    >
      <Text style={{ fontSize: props.size * 0.55, lineHeight: props.size * 0.7 }}>
        {props.emoji}
      </Text>
    </Pressable>
  );
}
