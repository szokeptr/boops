import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";

import * as Dialog from "../../components/ui/Dialog";
import { environmentCatalog } from "../../connection/catalog";
import { memberEnvironment } from "../../state/members";
import { relayEnvironmentDiscovery } from "../../state/relay";
import { useAtomCommand } from "../../state/use-atom-command";
import { memberFailureMessage } from "./useMemberCommands";

/** A member's way out: the environment forgets them, then this device forgets it. */
export function useLeaveEnvironment() {
  const leave = useAtomCommand(memberEnvironment.leave, { reportFailure: false });
  const remove = useAtomCommand(environmentCatalog.remove, "environment remove");
  const refreshRelay = useAtomCommand(
    relayEnvironmentDiscovery.refreshAfterMutation,
    "relay environment refresh",
  );
  const forget = async (environmentId: EnvironmentId) => {
    await remove(environmentId);
    void refreshRelay();
  };

  return (environment: {
    readonly environmentId: EnvironmentId;
    readonly environmentLabel: string;
  }) =>
    Dialog.confirm({
      title: `Leave ${environment.environmentLabel}?`,
      message:
        "Its bots disappear from this device. You can come back only if you're invited again.",
      confirmText: "Leave",
      destructive: true,
      onConfirm: () => {
        void leave({ environmentId: environment.environmentId, input: {} }).then((result) => {
          if (result._tag === "Success") return forget(environment.environmentId);
          if (isAtomCommandInterrupted(result)) return;
          // Offline or already removed: the owner's side can't be told, but this device can let go.
          Dialog.alert(
            `Could not reach ${environment.environmentLabel}`,
            memberFailureMessage(result),
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Remove from this device",
                style: "destructive",
                onPress: () => void forget(environment.environmentId),
              },
            ],
          );
        });
      },
    });
}
