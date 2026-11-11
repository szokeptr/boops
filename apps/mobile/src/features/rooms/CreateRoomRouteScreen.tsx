import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  defaultRoomTitle,
  EnvironmentId,
  type ProjectAvatar,
  roomParticipantKey,
  type RoomParticipant,
} from "@t3tools/contracts";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBar } from "../../components/ui/AppBar";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { cn } from "../../lib/cn";
import { useProjects } from "../../state/entities";
import { memberEnvironment } from "../../state/members";
import { roomEnvironment, useRooms } from "../../state/rooms";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { BotAvatarSlot } from "../bots/BotAvatarSlot";
import { useSelectWorkspaceDetail } from "../workspace/useSelectWorkspaceDetail";
import { PersonAvatar } from "./RoomAvatar";

const INPUT_CLASS = "min-h-11 rounded-xl border-continuous bg-card px-3 text-base text-foreground";
const TILE_SIZE = 56;

type CreateRoomRouteScreenProps = StaticScreenProps<{ readonly environmentId: string }>;

interface Candidate {
  readonly participant: RoomParticipant;
  readonly name: string;
  readonly avatar: ProjectAvatar | null;
}

/** New group chat: pick who's in it from avatar tiles, and optionally name it. */
export function CreateRoomRouteScreen(props: CreateRoomRouteScreenProps) {
  const environmentId = EnvironmentId.make(props.route.params.environmentId);
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const selectDetail = useSelectWorkspaceDetail();
  const createRoom = useAtomCommand(roomEnvironment.create, { reportFailure: false });
  const saveSettings = useAtomCommand(serverEnvironment.updateSettings, {
    reportFailure: false,
  });
  // A member's session sees only the bots shared with them, which are the ones they may bring.
  const bots: ReadonlyArray<Candidate> = useProjects()
    .filter(
      (project) =>
        project.environmentId === environmentId && !project.isScratch && project.archivedAt == null,
    )
    .map((project) => ({
      participant: { kind: "bot", projectId: project.id },
      name: project.title,
      avatar: project.avatar ?? null,
    }));
  const { people, ownerNamed } = useRooms(environmentId);
  const isOwner = useAtomValue(memberEnvironment.sessionMemberAtom(environmentId)) === null;
  const candidates: ReadonlyArray<Candidate> = [
    ...bots,
    ...people.map((entry): Candidate => ({
      participant: entry.person,
      name: entry.name,
      avatar: null,
    })),
  ];
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [title, setTitle] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const askName = isOwner && !ownerNamed;
  const chosen = candidates.filter((entry) => picked.has(roomParticipantKey(entry.participant)));
  const placeholder = defaultRoomTitle(chosen.map((entry) => entry.name));
  const close = () => navigation.goBack();

  const toggle = (entry: Candidate) => {
    const key = roomParticipantKey(entry.participant);
    const next = new Set(picked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setPicked(next);
  };

  const submit = async () => {
    if (submitting || chosen.length === 0) return;
    if (askName && ownerName.trim() === "") {
      setError("Tell the others what to call you.");
      return;
    }
    setSubmitting(true);
    setError(null);
    if (askName) {
      const saved = await saveSettings({
        environmentId,
        input: { patch: { ownerName: ownerName.trim() } },
      });
      if (saved._tag === "Failure") {
        setSubmitting(false);
        setError("Could not save your name. Try again.");
        return;
      }
    }
    const result = await createRoom({
      environmentId,
      input: {
        title: title.trim() || placeholder,
        botProjectIds: chosen.flatMap((entry) =>
          entry.participant.kind === "bot" ? [entry.participant.projectId] : [],
        ),
        memberIds: chosen.flatMap((entry) =>
          entry.participant.kind === "member" ? [entry.participant.memberId] : [],
        ),
        ...(isOwner ? {} : { includeOwner: picked.has("owner") }),
      },
    });
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const cause = squashAtomCommandFailure(result);
        setError(cause instanceof Error ? cause.message : "Could not start the group chat.");
      }
      setSubmitting(false);
      return;
    }
    close();
    selectDetail({
      name: "Room",
      params: { environmentId: String(environmentId), roomId: String(result.value.id) },
    });
  };

  return (
    <View className="flex-1 bg-sheet-solid">
      <AppBar
        title="New group chat"
        actions={[{ accessibilityLabel: "Cancel", icon: "xmark", onPress: close }]}
      />
      <ScrollView
        className="flex-1"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-5 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Text className="font-sans text-sm leading-5 text-foreground-muted">
          Pick who's in it. Bots answer when someone @mentions them, and can chime in when the chat
          is about something they help with.
        </Text>
        {askName ? (
          <View className="gap-2">
            <Text className="font-t3-medium text-sm text-foreground">Your name</Text>
            <TextInput
              accessibilityLabel="Your name"
              className={INPUT_CLASS}
              value={ownerName}
              onChangeText={setOwnerName}
              maxLength={60}
              autoCapitalize="words"
              autoComplete="given-name"
              textContentType="givenName"
              placeholder="What should everyone call you?"
            />
          </View>
        ) : null}
        {candidates.length === 0 ? (
          <Text className="font-sans text-sm text-foreground-muted">
            Add a bot or invite someone first, then start a group chat with them.
          </Text>
        ) : (
          <View accessibilityLabel="Who's in it" className="-mx-1 flex-row flex-wrap">
            {candidates.map((entry) => {
              const key = roomParticipantKey(entry.participant);
              const selected = picked.has(key);
              return (
                <View key={key} className="w-1/4 p-1">
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityLabel={entry.name}
                    accessibilityState={{ checked: selected }}
                    className="items-center gap-1.5 rounded-xl pt-2 pb-1.5 active:opacity-70"
                    onPress={() => toggle(entry)}
                  >
                    <View
                      className={cn(
                        "rounded-full p-0.5",
                        selected ? "border-2 border-primary" : "border-2 border-transparent",
                      )}
                    >
                      {entry.participant.kind === "bot" ? (
                        <BotAvatarSlot
                          avatar={entry.avatar}
                          name={entry.name}
                          status="idle"
                          size={TILE_SIZE}
                        />
                      ) : (
                        <PersonAvatar size={TILE_SIZE} />
                      )}
                      {selected ? (
                        <View className="absolute -right-0.5 -bottom-0.5 size-5 items-center justify-center rounded-full border-2 border-sheet-solid bg-primary">
                          <SymbolView
                            name="checkmark"
                            size={10}
                            weight="bold"
                            tintColorClassName="accent-primary-foreground"
                            type="monochrome"
                          />
                        </View>
                      ) : null}
                    </View>
                    <Text
                      numberOfLines={1}
                      className={cn(
                        "w-full text-center text-xs",
                        selected ? "font-t3-bold text-foreground" : "text-foreground-muted",
                      )}
                    >
                      {entry.name}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}
        <View className="gap-2">
          <Text className="font-t3-medium text-sm text-foreground">Name</Text>
          <TextInput
            accessibilityLabel="Group chat name"
            className={INPUT_CLASS}
            value={title}
            onChangeText={setTitle}
            maxLength={80}
            autoComplete="off"
            placeholder={placeholder}
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
          />
        </View>
        {error === null ? null : (
          <Text accessibilityRole="alert" className="text-sm text-danger">
            {error}
          </Text>
        )}
        <Button
          label="Start chat"
          tone="primary"
          fullWidth
          loading={submitting}
          disabled={chosen.length === 0}
          onPress={() => void submit()}
        />
      </ScrollView>
    </View>
  );
}
