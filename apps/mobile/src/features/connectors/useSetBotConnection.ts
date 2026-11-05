import { useAtomValue } from "@effect/atom-react";
import { connectorFailureMessage } from "@t3tools/client-runtime/connectors";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { ConnectorConnectionId, EnvironmentId, ProjectId } from "@t3tools/contracts";

import * as Dialog from "../../components/ui/Dialog";
import { connectorEnvironment } from "../../state/connectors";
import { useAtomCommand } from "../../state/use-atom-command";

/** Turns a connection on or off for a bot; the bot's project shell brings the change back. */
export function useSetBotConnection(environmentId: EnvironmentId) {
  const allowed = useAtomValue(connectorEnvironment.setBotConnection.permissionAtom(environmentId));
  const run = useAtomCommand(connectorEnvironment.setBotConnection, { reportFailure: false });
  const set = async (input: {
    readonly projectId: ProjectId;
    readonly connectionId: ConnectorConnectionId;
    readonly enabled: boolean;
  }) => {
    const result = await run({ environmentId, input });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      Dialog.alert(
        input.enabled ? "Could not turn the connection on" : "Could not turn it off",
        connectorFailureMessage(squashAtomCommandFailure(result)),
      );
    }
  };
  return { allowed, set };
}
