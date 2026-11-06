import type { RelayEnvironmentInvite } from "@t3tools/contracts/relay";
import { useState } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { useConnectionController } from "../connection/useConnectionController";
import { useSelectWorkspaceTab } from "../workspace/useSelectWorkspaceTab";
import { memberFailureMessage } from "./useMemberCommands";

type ConnectionController = ReturnType<typeof useConnectionController>;

/** Invites to chat with someone's bots. Accepting connects and opens the bot list. */
export function EnvironmentInviteCards() {
  return <EnvironmentInviteCardList controller={useConnectionController()} />;
}

export function EnvironmentInviteCardList(props: { readonly controller: ConnectionController }) {
  const { controller } = props;
  if (controller.invites.length === 0) return null;
  return (
    <View collapsable={false} className="gap-3">
      {controller.invites.map((invite) => (
        <EnvironmentInviteCard key={invite.inviteId} invite={invite} controller={controller} />
      ))}
    </View>
  );
}

function EnvironmentInviteCard(props: {
  readonly invite: RelayEnvironmentInvite;
  readonly controller: ConnectionController;
}) {
  const { invite, controller } = props;
  const selectTab = useSelectWorkspaceTab();
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);

  const accept = async () => {
    setBusy("accept");
    const result = await controller.acceptInvite(invite.inviteId);
    setBusy(null);
    if (result._tag === "Failure") {
      Dialog.alert("Could not accept the invite", memberFailureMessage(result));
      return;
    }
    selectTab("threads");
  };
  const decline = () =>
    Dialog.confirm({
      title: `Decline ${invite.environmentLabel}?`,
      message: "You won't see their bots. They can invite you again.",
      confirmText: "Decline",
      destructive: true,
      onConfirm: () => {
        setBusy("decline");
        void controller.declineInvite(invite.inviteId).then((result) => {
          setBusy(null);
          if (result._tag === "Failure") {
            Dialog.alert("Could not decline the invite", memberFailureMessage(result));
          }
        });
      },
    });

  return (
    <View collapsable={false} className="gap-4 rounded-[24px] bg-grouped-card p-5">
      <Text className="text-base leading-snug text-foreground">
        <Text className="font-t3-bold">{invite.environmentLabel}</Text> invited you to chat with
        their bots
      </Text>
      <View className="flex-row gap-3">
        <View className="flex-1">
          <Button
            label="Decline"
            tone="secondary"
            disabled={busy !== null}
            loading={busy === "decline"}
            onPress={decline}
            fullWidth
          />
        </View>
        <View className="flex-1">
          <Button
            label="Accept"
            tone="primary"
            disabled={busy !== null}
            loading={busy === "accept"}
            onPress={() => void accept()}
            fullWidth
          />
        </View>
      </View>
    </View>
  );
}
