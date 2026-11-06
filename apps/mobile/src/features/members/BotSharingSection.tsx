import { useAtomValue } from "@effect/atom-react";
import { isBotSharedWith } from "@t3tools/client-runtime/state/members";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import { useState } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { useConnectorConnections } from "../../state/connectors";
import { memberEnvironment, useEnvironmentMembers } from "../../state/members";
import { SettingsSection } from "../settings/components/SettingsSection";
import { SettingsSwitchRow } from "../settings/components/SettingsSwitchRow";
import { MemberInviteForm, memberStatusText } from "./MemberInviteForm";
import { useMemberCommands } from "./useMemberCommands";

export const MEMBER_PRIVACY_NOTE =
  "They chat in their own threads. You won't see their chats, and they won't see yours.";

type BotSharingSectionProps = {
  readonly bot: Pick<
    EnvironmentProject,
    "id" | "environmentId" | "title" | "memberIds" | "connectionIds" | "memberConnectionIds"
  >;
  /** Names the machine when the bot has checkouts on several. */
  readonly environmentLabel?: string | null;
};

/** Who a bot is shared with, a switch per person, and a way to invite someone new with it. */
export function BotSharingSection(props: BotSharingSectionProps) {
  const allowed = useAtomValue(
    memberEnvironment.setBotAccess.permissionAtom(props.bot.environmentId),
  );
  return allowed ? <BotSharingSectionContent {...props} /> : null;
}

function BotSharingSectionContent(props: BotSharingSectionProps) {
  const { bot } = props;
  const { members, canInvite, loaded, error } = useEnvironmentMembers(bot.environmentId);
  const commands = useMemberCommands(bot.environmentId);
  const [inviting, setInviting] = useState(false);
  const { connections } = useConnectorConnections(bot.environmentId);
  const botConnections = connections.filter((connection) =>
    (bot.connectionIds ?? []).includes(connection.id),
  );
  const sharedWithAnyone = (bot.memberIds ?? []).length > 0;

  return (
    <View className="gap-5">
      <SettingsSection
        title={props.environmentLabel ? `Shared on ${props.environmentLabel}` : "Shared with"}
        footer={MEMBER_PRIVACY_NOTE}
      >
        {!loaded ? (
          <Text className="p-4 text-base text-foreground-muted">{error ?? "Loading people…"}</Text>
        ) : members.length === 0 && !inviting ? (
          <Text className="p-4 text-base text-foreground-muted">Not shared with anyone yet.</Text>
        ) : (
          members.map((member) => (
            <SettingsSwitchRow
              key={member.id}
              label={member.label}
              subtitle={memberStatusText(member)}
              value={isBotSharedWith(bot, member.id)}
              disabled={!commands.canShare}
              onValueChange={(enabled) =>
                void commands.setBotAccess({ projectId: bot.id, memberId: member.id, enabled })
              }
            />
          ))
        )}
        {loaded && !canInvite ? (
          <Text className="p-4 text-sm text-foreground-muted">
            Inviting someone needs Boops Connect. Turn it on for this environment in the desktop
            app's Settings, then invite them here.
          </Text>
        ) : loaded && !inviting ? (
          <ListActionRow
            icon="person.badge.plus"
            label="Invite someone"
            disabled={!commands.canInvite}
            onPress={() => setInviting(true)}
          />
        ) : null}
      </SettingsSection>
      {sharedWithAnyone && botConnections.length > 0 ? (
        <SettingsSection
          title="Connections they can use"
          footer={`These are your accounts. ${bot.title} acts as you when it uses them.`}
        >
          {botConnections.map((connection) => (
            <SettingsSwitchRow
              key={connection.id}
              label={connection.displayName}
              value={(bot.memberConnectionIds ?? []).includes(connection.id)}
              disabled={!commands.canShare}
              onValueChange={(enabled) =>
                void commands.setBotConnectionAccess({
                  projectId: bot.id,
                  connectionId: connection.id,
                  enabled,
                })
              }
            />
          ))}
        </SettingsSection>
      ) : null}
      {inviting ? (
        <MemberInviteForm
          submitLabel={`Invite and share ${bot.title}`}
          onCancel={() => setInviting(false)}
          onSubmit={async (input) => {
            const failure = await commands.invite({ ...input, projectIds: [bot.id] });
            if (failure === null) setInviting(false);
            return failure;
          }}
        />
      ) : null}
    </View>
  );
}
