import { useAtomValue } from "@effect/atom-react";
import { isBotSharedWith } from "@t3tools/client-runtime/state/members";
import { resolveEnvironmentMachineKind, type ProjectId } from "@t3tools/contracts";
import { useEffect, useEffectEvent, useState } from "react";
import { AppState, Modal, Platform, ScrollView as NativeScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EnvironmentMachineSymbol } from "../../components/EnvironmentMachineSymbol";
import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { EmptyState } from "../../components/ui/EmptyState";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { useEnvironmentBots } from "../../state/connectors";
import { memberEnvironment, useEnvironmentMembers } from "../../state/members";
import { useRooms } from "../../state/rooms";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { MEMBER_PRIVACY_NOTE } from "../members/BotSharingSection";
import { MemberInviteForm, memberStatusText } from "../members/MemberInviteForm";
import { useMemberCommands } from "../members/useMemberCommands";
import { useRoomCommands } from "../rooms/useRoomCommands";
import {
  SettingsEnvironmentFilterHeader,
  useSettingsEnvironmentMenu,
} from "./components/SettingsEnvironmentFilterHeader";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";
import { type SettingsTarget, useSettingsEnvironmentFilter } from "./settings-environment-filter";

/** People the owner invited to chat with some of their bots, and which bots each one has. */
export function SettingsMembersRouteScreen() {
  const insets = useSafeAreaInsets();
  const environmentMenu = useSettingsEnvironmentMenu();
  const { availableTargets, selectedTargets } = useSettingsEnvironmentFilter();
  return (
    <>
      <SettingsEnvironmentFilterHeader />
      <SettingsScreen title="Members" menus={[environmentMenu]}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
          className="flex-1"
          contentContainerClassName="gap-5 px-5 pt-4"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        >
          {selectedTargets.length > 0 ? (
            selectedTargets.map((environment) => (
              <EnvironmentMembers
                key={environment.environmentId}
                environment={environment}
                labelled={selectedTargets.length > 1}
              />
            ))
          ) : (
            <Text className="px-2 text-base text-foreground-muted">
              {availableTargets.length === 0
                ? "Connect an environment to share its bots."
                : "No environments match these filters. Change the filter above."}
            </Text>
          )}
        </ScrollView>
      </SettingsScreen>
    </>
  );
}

type EnvironmentMembersProps = {
  readonly environment: SettingsTarget;
  readonly labelled: boolean;
};

function EnvironmentMembers(props: EnvironmentMembersProps) {
  const allowed = useAtomValue(
    memberEnvironment.setBotAccess.permissionAtom(props.environment.environmentId),
  );
  if (allowed) return <EnvironmentMembersContent {...props} />;
  return (
    <Text className="px-2 text-base text-foreground-muted">
      Only the owner of {props.environment.label} chooses who its bots are shared with.
    </Text>
  );
}

function EnvironmentMembersContent(props: EnvironmentMembersProps) {
  const environmentId = props.environment.environmentId;
  const { members, canInvite, loaded, error } = useEnvironmentMembers(environmentId);
  const bots = useEnvironmentBots(environmentId);
  const commands = useMemberCommands(environmentId);
  const [inviting, setInviting] = useState(false);
  const invite = () => setInviting(true);

  return (
    <View className="gap-5">
      {props.labelled ? (
        <View className="flex-row items-center gap-2 px-2">
          <EnvironmentMachineSymbol
            kind={resolveEnvironmentMachineKind(props.environment.serverConfig)}
            size={16}
            tintColorClassName="accent-foreground-muted"
          />
          <Text className="font-t3-bold text-base text-foreground">{props.environment.label}</Text>
        </View>
      ) : null}
      {!loaded ? (
        <Text className="px-2 text-base text-foreground-muted">{error ?? "Loading people…"}</Text>
      ) : members.length === 0 ? (
        <EmptyState
          title="No one yet"
          detail={`Invite someone to chat with your bots. ${MEMBER_PRIVACY_NOTE}`}
          variant="plain"
          {...(canInvite && commands.canInvite ? { actionLabel: "Invite", onAction: invite } : {})}
        />
      ) : (
        members.map((member) => (
          <SettingsSection key={member.id} title={member.label} footer={memberStatusText(member)}>
            {bots.map((bot) => (
              <SettingsSwitchRow
                key={bot.id}
                label={bot.title}
                value={isBotSharedWith(bot, member.id)}
                disabled={!commands.canShare}
                onValueChange={(enabled) =>
                  void commands.setBotAccess({ projectId: bot.id, memberId: member.id, enabled })
                }
              />
            ))}
            <SettingsSwitchRow
              label="Can start group chats"
              value={member.canCreateRooms}
              disabled={!commands.canShare}
              onValueChange={(enabled) => void commands.setCanCreateRooms(member, enabled)}
            />
            <ListActionRow
              icon="person.fill.xmark"
              label={`Remove ${member.label}`}
              tone="danger"
              disabled={!commands.canShare}
              onPress={() => commands.remove(member)}
            />
          </SettingsSection>
        ))
      )}
      {loaded && !canInvite ? (
        <Text className="px-2 text-sm text-foreground-muted">
          Inviting someone needs Boops Connect. Turn it on for this environment in the desktop app's
          Settings, then invite them here.
        </Text>
      ) : loaded && members.length > 0 ? (
        <Button
          label="Invite someone"
          icon="person.badge.plus"
          tone="secondary"
          disabled={!commands.canInvite}
          onPress={invite}
          fullWidth
        />
      ) : null}
      <OwnerNameSection environment={props.environment} />
      <OthersRoomsSection environment={props.environment} />
      {inviting ? (
        <MemberInviteSheet
          bots={bots}
          onInvite={commands.invite}
          onClose={() => setInviting(false)}
        />
      ) : null}
    </View>
  );
}

/** What people and bots in group chats call the owner. Saved when the field loses focus. */
function OwnerNameSection(props: { readonly environment: SettingsTarget }) {
  const { environmentId } = props.environment;
  const saved = props.environment.serverConfig.settings.ownerName;
  const updateSettings = useAtomCommand(
    serverEnvironment.updateSettings,
    "Could not save your name",
  );
  const [draft, setDraft] = useState<string | null>(null);
  const send = () => {
    const next = draft?.trim();
    if (next !== undefined && next !== saved)
      void updateSettings({ environmentId, input: { patch: { ownerName: next } } });
  };
  const save = () => {
    send();
    setDraft(null);
  };
  const sendPending = useEffectEvent(send);
  const editing = draft !== null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the field may never blur: the app can be backgrounded and killed, or the screen closed, mid-edit
  useEffect(() => {
    if (!editing) return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") sendPending();
    });
    return () => {
      subscription.remove();
      sendPending();
    };
  }, [editing]);
  return (
    <SettingsSection
      title="Group chats"
      footer="What people and bots in your group chats call you."
    >
      <View className="gap-2 bg-grouped-card p-4">
        <Text className="text-sm font-t3-medium text-foreground-muted">Your name</Text>
        <AppTextInput
          accessibilityLabel="Your name in group chats"
          className="min-h-11 rounded-xl border-continuous bg-card px-3 text-base text-foreground"
          value={draft ?? saved}
          maxLength={60}
          placeholder="Owner"
          placeholderTextColorClassName="accent-placeholder"
          returnKeyType="done"
          onChangeText={setDraft}
          onSubmitEditing={save}
          onBlur={save}
        />
      </View>
    </SettingsSection>
  );
}

/** Group chats members started without the owner: who is in them, and a way in or to end one. */
function OthersRoomsSection(props: { readonly environment: SettingsTarget }) {
  const { environmentId } = props.environment;
  const { rooms } = useRooms(environmentId);
  const commands = useRoomCommands(environmentId);
  const others = rooms.filter((room) => !room.joined);
  if (others.length === 0) return null;
  return (
    <SettingsSection title="Group chats you're not in">
      {others.map((room) => {
        const people = room.participants.map((entry) => entry.name).join(", ");
        return (
          <ListActionRow
            key={room.id}
            icon="person.2"
            label={room.title}
            description={people}
            onPress={() =>
              Dialog.alert(
                room.title,
                `${people}\n\nJoin to read and write in it. Everyone in it sees you there.`,
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Delete…",
                    style: "destructive",
                    onPress: () => commands.delete(room.id, room.title, () => undefined),
                  },
                  {
                    text: "Join",
                    onPress: () => void commands.add(room.id, { kind: "owner" }),
                  },
                ],
              )
            }
          />
        );
      })}
    </SettingsSection>
  );
}

/** Name, email, and which bots to share right away. */
function MemberInviteSheet(props: {
  readonly bots: ReturnType<typeof useEnvironmentBots>;
  readonly onInvite: ReturnType<typeof useMemberCommands>["invite"];
  readonly onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [shared, setShared] = useState<ReadonlySet<ProjectId>>(new Set());
  return (
    <Modal
      animationType="slide"
      presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"}
      onRequestClose={props.onClose}
    >
      <NativeScrollView
        className="flex-1 bg-sheet-solid"
        contentContainerClassName="gap-5 p-5"
        contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View className="gap-1">
          <Text className="font-t3-bold text-lg text-foreground">Invite someone</Text>
          <Text className="font-sans text-sm leading-5 text-foreground-muted">
            {MEMBER_PRIVACY_NOTE}
          </Text>
        </View>
        {props.bots.length > 0 ? (
          <SettingsSection title="Bots to share">
            {props.bots.map((bot) => (
              <SettingsSwitchRow
                key={bot.id}
                label={bot.title}
                value={shared.has(bot.id)}
                onValueChange={(enabled) =>
                  setShared((current) => {
                    const next = new Set(current);
                    if (enabled) next.add(bot.id);
                    else next.delete(bot.id);
                    return next;
                  })
                }
              />
            ))}
          </SettingsSection>
        ) : null}
        <MemberInviteForm
          submitLabel="Invite"
          onCancel={props.onClose}
          onSubmit={async (input) => {
            const failure = await props.onInvite({ ...input, projectIds: [...shared] });
            if (failure === null) props.onClose();
            return failure;
          }}
        />
      </NativeScrollView>
    </Modal>
  );
}
