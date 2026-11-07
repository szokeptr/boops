import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { resolveThreadStatus } from "@t3tools/client-runtime/state/thread-status";
import { useNavigation } from "@react-navigation/native";
import * as Haptics from "expo-haptics";
import { useEffect, useRef } from "react";
import { Platform, Pressable, ScrollView, type ScrollViewInstance, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";
import { useQuietThreadShell } from "../../state/entities";
import { BotAvatarSlot } from "../bots/BotAvatarSlot";
import { useBotCall } from "./BotCallProvider";
import { callStatusLabel, callTranscript } from "./botCallPresentation";
import { useCallClock } from "./callClock";
import { CALL_END_RED } from "./callColors";

function CallControl(props: {
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
      hitSlop={6}
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        props.onPress();
      }}
      className={cn(
        "size-[60px] items-center justify-center rounded-full active:opacity-70",
        props.tone === "end" ? null : props.active ? "bg-foreground" : "bg-subtle-strong",
      )}
      style={props.tone === "end" ? { backgroundColor: CALL_END_RED } : undefined}
    >
      <SymbolView
        name={props.icon}
        size={24}
        type="monochrome"
        {...(props.tone === "end"
          ? { tintColor: "#FFFFFF" }
          : { tintColorClassName: props.active ? "accent-screen" : "accent-foreground" })}
      />
    </Pressable>
  );
}

/**
 * The call expanded: who is on the line and everything said so far. Collapsing it leaves the call
 * going as the floating pill.
 */
export function BotCallScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { call, session } = useBotCall();
  const phase = call?.state.phase ?? null;
  const now = useCallClock(phase === "live");
  const thread = useQuietThreadShell(
    call === null ? null : scopeThreadRef(call.environmentId, call.threadId),
  );
  const threadStatus = thread === null ? null : resolveThreadStatus(thread);
  const working = threadStatus === "working" || threadStatus === "waiting";
  const scroll = useRef<ScrollViewInstance>(null);

  const collapse = () => {
    if (navigation.canGoBack()) navigation.goBack();
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tells the session the pill should stay hidden while this screen is up
  useEffect(() => {
    session.setScreenOpen(true);
    return () => session.setScreenOpen(false);
  }, [session]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a forgotten call has nothing left to show, so the screen closes
  useEffect(() => {
    if (phase === null && navigation.canGoBack()) navigation.goBack();
  }, [navigation, phase]);

  if (call === null) return <View className="flex-1 bg-screen" />;
  const { state } = call;
  const live = state.phase === "connecting" || state.phase === "live";
  const transcript = callTranscript(state);

  return (
    <View
      className="flex-1 bg-screen"
      style={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }}
    >
      <View className="px-4">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Show the conversation"
          hitSlop={8}
          onPress={collapse}
          className="size-11 items-center justify-center rounded-full bg-subtle-strong active:opacity-70"
        >
          <SymbolView
            name="chevron.down"
            size={18}
            type="monochrome"
            tintColorClassName="accent-foreground"
          />
        </Pressable>
      </View>

      <View className="items-center px-6">
        <BotAvatarSlot
          avatar={call.botAvatar}
          name={call.botName}
          status={working && live ? "working" : "idle"}
          size={88}
        />
        <Text className="mt-3 font-t3-bold text-[22px] text-foreground" numberOfLines={1}>
          {call.botName}
        </Text>
        <Text
          accessibilityLiveRegion="polite"
          className={cn(
            "mt-0.5 text-center text-[15px] tabular-nums",
            state.phase === "failed" ? "text-danger-foreground" : "text-foreground-muted",
          )}
        >
          {working && state.phase === "live"
            ? `Working on it · ${callStatusLabel(state, now)}`
            : callStatusLabel(state, now)}
        </Text>
        {state.phase === "failed" && state.error?.reason === "not-configured" ? (
          <Text className="mt-2 max-w-[300px] text-center text-sm text-foreground-muted">
            Add it in Boops on your computer, under Settings, then call again.
          </Text>
        ) : null}
      </View>

      <ScrollView
        ref={scroll}
        className="mt-6 flex-1"
        contentContainerClassName="gap-5 px-6 pb-6"
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
      >
        {transcript.map((line, index) => (
          <Text
            // oxlint-disable-next-line react/no-array-index-key -- the transcript only grows at its end, so a line's position is its identity
            key={index}
            className={cn(
              "text-[19px] leading-[26px]",
              line.speaker === "user"
                ? "max-w-[85%] self-end text-right text-foreground-muted"
                : "max-w-[90%] self-start text-foreground",
            )}
          >
            {line.text}
          </Text>
        ))}
      </ScrollView>

      <View className="flex-row items-center px-6 pt-2">
        {live ? (
          <>
            <View className="flex-1 flex-row gap-3">
              <CallControl
                label={state.muted ? "Unmute" : "Mute"}
                icon={state.muted ? "mic.slash.fill" : "mic.fill"}
                active={state.muted}
                onPress={() => session.setMuted(!state.muted)}
              />
              {Platform.OS === "ios" ? (
                <CallControl
                  label="Speaker"
                  icon="speaker.wave.2.fill"
                  active={call.speakerOn}
                  onPress={() => void session.setSpeaker(!call.speakerOn)}
                />
              ) : null}
            </View>
            <CallControl
              label="End call"
              icon="phone.down.fill"
              tone="end"
              onPress={() => session.hangUp()}
            />
          </>
        ) : state.phase === "failed" ? (
          <View className="flex-1 flex-row justify-center gap-3">
            <CallControl label="Call again" icon="phone.fill" onPress={() => session.start(call)} />
          </View>
        ) : (
          <View className="h-[60px]" />
        )}
      </View>
    </View>
  );
}
