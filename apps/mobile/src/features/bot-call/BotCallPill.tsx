import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { resolveThreadStatus } from "@t3tools/client-runtime/state/thread-status";
import * as Haptics from "expo-haptics";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { Platform, Pressable, useWindowDimensions, View } from "react-native";
import Animated, {
  ReduceMotion,
  SlideInRight,
  SlideInUp,
  SlideOutRight,
  SlideOutUp,
  useAnimatedStyle,
  useReducedMotion,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FullWindowOverlay } from "react-native-screens";

import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { GlassSurface } from "../../components/ui/GlassSurface";
import { cn } from "../../lib/cn";
import { rootNavigationRef, whenRootNavigationReady } from "../../lib/rootNavigation";
import { useQuietThreadShell } from "../../state/entities";
import { BotAvatarSlot } from "../bots/BotAvatarSlot";
import { visorColors } from "@t3tools/client-runtime/bot-avatar";
import { specFor } from "@t3tools/shared/botAvatar";
import { CallEqualizer } from "./CallEqualizer";
import { callAudioLevel, useBotCall } from "./BotCallProvider";
import { callStatusLabel } from "./botCallPresentation";
import type { ActiveBotCall } from "./botCallSession";
import { useCallClock } from "./callClock";
import { CALL_END_RED } from "./callColors";

const PILL_HEIGHT = 64;
const PILL_MAX_WIDTH = 440;
// Clears the conversation's native header with some air, so the pill sits just under it.
const HEADER_CLEARANCE = 64;
// How long "Call ended" stays before the pill goes.
const ENDED_LINGER_MS = 1_200;
// Only position animates: Liquid Glass created under a fading parent renders flat.
const ENTERING = SlideInUp.duration(260).reduceMotion(ReduceMotion.System);
const EXITING = SlideOutUp.duration(200).reduceMotion(ReduceMotion.System);

// The edge tab other screens get: docked like the dictation pill, above the bottom chrome.
const TAB_HEIGHT = 44;
const TAB_BOTTOM_CLEARANCE = 64;
const TAB_ENTERING = SlideInRight.duration(260).reduceMotion(ReduceMotion.System);
const TAB_EXITING = SlideOutRight.duration(200).reduceMotion(ReduceMotion.System);

export function openCallScreen() {
  whenRootNavigationReady(() => rootNavigationRef.navigate("BotCall"));
}

const subscribeToRoute = (onChange: () => void) => rootNavigationRef.addListener("state", onChange);
const currentRoute = () =>
  rootNavigationRef.isReady() ? rootNavigationRef.getCurrentRoute() : undefined;

/** Whether the screen in front is the conversation the call belongs to. */
function useViewingCallConversation(call: ActiveBotCall | null): boolean {
  const route = useSyncExternalStore(subscribeToRoute, currentRoute, currentRoute);
  if (call === null || route?.name !== "Thread") return false;
  const params = route.params as
    | { readonly environmentId?: string; readonly threadId?: string }
    | undefined;
  return params?.environmentId === call.environmentId && params.threadId === call.threadId;
}

const callColor = (call: ActiveBotCall) =>
  visorColors(call.botAvatar ?? specFor(call.botName)).body;

/** The app-wide call pill: floats over every screen while a call is on and its screen is closed. */
export function GlobalBotCallPill(props: { readonly children: ReactNode }) {
  const { call, screenOpen, session } = useBotCall();
  const phase = call?.state.phase ?? null;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- forgets a finished call a moment after it ends, wherever the user is
  useEffect(() => {
    if (phase !== "ended") return;
    const timer = setTimeout(() => session.dismiss(), ENDED_LINGER_MS);
    return () => clearTimeout(timer);
  }, [phase, session]);

  const inConversation = useViewingCallConversation(call);
  // Both stay mounted for the whole call and slide away when not wanted: a glass view mounted
  // again mid-transition loses its material. The pill belongs to the call's own conversation;
  // anywhere else it would cover the screen, so a small tab docks at the edge instead.
  const pill =
    call !== null ? (
      <View pointerEvents="box-none" className="absolute inset-0">
        <BotCallPill call={call} hidden={screenOpen || !inConversation} />
        <BotCallTab call={call} hidden={screenOpen || inConversation} />
      </View>
    ) : null;
  return (
    <>
      {props.children}
      {pill && Platform.OS === "ios" ? <FullWindowOverlay>{pill}</FullWindowOverlay> : pill}
    </>
  );
}

function PillButton(props: {
  readonly label: string;
  readonly icon: AppSymbolName;
  readonly onPress: () => void;
  readonly active?: boolean;
  readonly tone?: "end";
}) {
  return (
    <Pressable
      accessibilityRole={props.active === undefined ? "button" : "switch"}
      accessibilityLabel={props.label}
      {...(props.active === undefined ? {} : { accessibilityState: { checked: props.active } })}
      hitSlop={4}
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        props.onPress();
      }}
      className={cn(
        "size-12 items-center justify-center rounded-full active:opacity-70",
        props.tone === "end" ? null : props.active ? "bg-foreground" : "bg-subtle-strong",
      )}
      style={props.tone === "end" ? { backgroundColor: CALL_END_RED } : undefined}
    >
      <SymbolView
        name={props.icon}
        size={20}
        type="monochrome"
        {...(props.tone === "end"
          ? { tintColor: "#FFFFFF" }
          : { tintColorClassName: props.active ? "accent-screen" : "accent-foreground" })}
      />
    </Pressable>
  );
}

function BotCallPill(props: { readonly call: ActiveBotCall; readonly hidden: boolean }) {
  const { call, hidden } = props;
  const { session } = useBotCall();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const offscreen = -(insets.top + HEADER_CLEARANCE + PILL_HEIGHT + 24);
  const slide = useAnimatedStyle(() => {
    const target = hidden ? offscreen : 0;
    return {
      transform: [{ translateY: reduceMotion ? target : withTiming(target, { duration: 240 }) }],
    };
  }, [hidden, offscreen, reduceMotion]);
  const { width } = useWindowDimensions();
  const { state } = call;
  const live = state.phase === "connecting" || state.phase === "live";
  const now = useCallClock(state.phase === "live");
  const thread = useQuietThreadShell(scopeThreadRef(call.environmentId, call.threadId));
  const threadStatus = thread === null ? null : resolveThreadStatus(thread);
  const working = live && (threadStatus === "working" || threadStatus === "waiting");
  const status =
    state.phase === "live" && working
      ? `Working on it · ${callStatusLabel(state, now)}`
      : callStatusLabel(state, now);

  return (
    <Animated.View
      entering={ENTERING}
      exiting={EXITING}
      pointerEvents={hidden ? "none" : "box-none"}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? "no-hide-descendants" : "auto"}
      className="absolute inset-x-0"
      style={{ top: insets.top + HEADER_CLEARANCE }}
    >
      <Animated.View pointerEvents="box-none" className="items-center" style={slide}>
        <GlassSurface
          style={{
            height: PILL_HEIGHT,
            width: Math.min(width - insets.left - insets.right - 24, PILL_MAX_WIDTH),
          }}
        >
          <View className="flex-1 flex-row items-center gap-2 pe-2 ps-2">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Call with ${call.botName}, ${status}. Show call`}
              onPress={openCallScreen}
              className="min-w-0 flex-1 flex-row items-center gap-3 active:opacity-70"
            >
              <BotAvatarSlot
                avatar={call.botAvatar}
                name={call.botName}
                status={working ? "working" : "idle"}
                size={44}
              />
              <View className="min-w-0 flex-1 justify-center">
                {state.phase === "live" ? (
                  <CallEqualizer
                    levels={callAudioLevel}
                    color={callColor(call)}
                    height={44}
                    bars={18}
                  />
                ) : (
                  <Text
                    accessibilityLiveRegion="polite"
                    className={cn(
                      "text-[15px] tabular-nums",
                      state.phase === "failed" ? "text-danger-foreground" : "text-foreground-muted",
                    )}
                    numberOfLines={1}
                  >
                    {status}
                  </Text>
                )}
              </View>
            </Pressable>
            {live ? (
              <>
                {Platform.OS === "ios" ? (
                  <PillButton
                    label="Speaker"
                    icon="speaker.wave.2.fill"
                    active={call.speakerOn}
                    onPress={() => void session.setSpeaker(!call.speakerOn)}
                  />
                ) : null}
                <PillButton
                  label={state.muted ? "Unmute" : "Mute"}
                  icon={state.muted ? "mic.slash.fill" : "mic.fill"}
                  active={state.muted}
                  onPress={() => session.setMuted(!state.muted)}
                />
                <PillButton
                  label="End call"
                  icon="phone.down.fill"
                  tone="end"
                  onPress={() => session.hangUp()}
                />
              </>
            ) : state.phase === "failed" ? (
              <>
                <PillButton
                  label="Call again"
                  icon="phone.fill"
                  onPress={() => session.start(call)}
                />
                <PillButton
                  label="Close"
                  icon="xmark.circle.fill"
                  onPress={() => session.dismiss()}
                />
              </>
            ) : null}
          </View>
        </GlassSurface>
      </Animated.View>
    </Animated.View>
  );
}

/** The call away from its conversation: a small tab at the screen's edge that opens the call. */
function BotCallTab(props: { readonly call: ActiveBotCall; readonly hidden: boolean }) {
  const { call, hidden } = props;
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const slide = useAnimatedStyle(() => {
    const target = hidden ? 160 : 0;
    return {
      transform: [{ translateX: reduceMotion ? target : withTiming(target, { duration: 240 }) }],
    };
  }, [hidden, reduceMotion]);
  const live = call.state.phase === "live";

  return (
    <Animated.View
      entering={TAB_ENTERING}
      exiting={TAB_EXITING}
      pointerEvents={hidden ? "none" : "box-none"}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? "no-hide-descendants" : "auto"}
      className="absolute"
      style={{ right: insets.right, bottom: Math.max(insets.bottom, 12) + TAB_BOTTOM_CLEARANCE }}
    >
      <Animated.View style={slide}>
        <GlassSurface
          style={{
            height: TAB_HEIGHT,
            borderRadius: TAB_HEIGHT / 2,
            borderTopRightRadius: 0,
            borderBottomRightRadius: 0,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`On a call with ${call.botName}. Show call`}
            onPress={openCallScreen}
            className="h-full flex-row items-center gap-2 pe-3 ps-1.5 active:opacity-70"
          >
            <BotAvatarSlot avatar={call.botAvatar} name={call.botName} status="idle" size={32} />
            {live ? (
              <CallEqualizer levels={callAudioLevel} color={callColor(call)} height={24} bars={8} />
            ) : (
              <SymbolView
                name="phone.fill"
                size={16}
                type="monochrome"
                tintColorClassName="accent-foreground"
              />
            )}
          </Pressable>
        </GlassSurface>
      </Animated.View>
    </Animated.View>
  );
}
