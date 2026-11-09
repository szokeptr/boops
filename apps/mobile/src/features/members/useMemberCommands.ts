import { useAtomValue } from "@effect/atom-react";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  ConnectorConnectionId,
  EnvironmentId,
  EnvironmentMember,
  EnvironmentMemberId,
  ProjectId,
} from "@t3tools/contracts";

import * as Dialog from "../../components/ui/Dialog";
import { memberEnvironment } from "../../state/members";
import { useAtomCommand } from "../../state/use-atom-command";

export function memberFailureMessage(
  result: Parameters<typeof squashAtomCommandFailure>[0],
): string {
  const error = squashAtomCommandFailure(result);
  return error instanceof Error && error.message.length > 0
    ? error.message
    : "Something went wrong. Try again.";
}

function reportFailure(title: string, result: AtomCommandResult<unknown, unknown>): boolean {
  if (result._tag !== "Failure") return false;
  if (!isAtomCommandInterrupted(result)) Dialog.alert(title, memberFailureMessage(result));
  return true;
}

/** The owner's member changes; `members.subscribe` and the project shells bring them back. */
export function useMemberCommands(environmentId: EnvironmentId) {
  const canShare = useAtomValue(memberEnvironment.setBotAccess.permissionAtom(environmentId));
  const canInvite = useAtomValue(memberEnvironment.invite.permissionAtom(environmentId));
  const setBotAccessCommand = useAtomCommand(memberEnvironment.setBotAccess, {
    reportFailure: false,
  });
  const setBotConnectionAccessCommand = useAtomCommand(memberEnvironment.setBotConnectionAccess, {
    reportFailure: false,
  });
  const inviteCommand = useAtomCommand(memberEnvironment.invite, { reportFailure: false });
  const removeCommand = useAtomCommand(memberEnvironment.remove, { reportFailure: false });
  const updateCommand = useAtomCommand(memberEnvironment.update, { reportFailure: false });

  const setBotAccess = async (input: {
    readonly projectId: ProjectId;
    readonly memberId: EnvironmentMemberId;
    readonly enabled: boolean;
  }) => {
    const result = await setBotAccessCommand({ environmentId, input });
    reportFailure(input.enabled ? "Could not share the bot" : "Could not stop sharing", result);
  };

  const setBotConnectionAccess = async (input: {
    readonly projectId: ProjectId;
    readonly connectionId: ConnectorConnectionId;
    readonly enabled: boolean;
  }) => {
    const result = await setBotConnectionAccessCommand({ environmentId, input });
    reportFailure(
      input.enabled ? "Could not share the connection" : "Could not stop sharing it",
      result,
    );
  };

  const setCanCreateRooms = async (member: EnvironmentMember, canCreateRooms: boolean) => {
    const result = await updateCommand({
      environmentId,
      input: { memberId: member.id, canCreateRooms },
    });
    reportFailure("Could not change it", result);
  };

  /** Resolves to the error to show beside the form, or null once the invite is sent. */
  const invite = async (input: {
    readonly label: string;
    readonly email: string;
    readonly projectIds: ReadonlyArray<ProjectId>;
  }): Promise<string | null> => {
    const result = await inviteCommand({ environmentId, input });
    if (result._tag === "Success") return null;
    return isAtomCommandInterrupted(result) ? null : memberFailureMessage(result);
  };

  const remove = (member: EnvironmentMember) =>
    Dialog.confirm({
      title: `Remove ${member.label}?`,
      message: `${member.label} loses every shared bot and is disconnected right away. Their chats stay archived on this environment.`,
      confirmText: "Remove",
      destructive: true,
      onConfirm: () => {
        void removeCommand({ environmentId, input: { memberId: member.id } }).then((result) =>
          reportFailure(`Could not remove ${member.label}`, result),
        );
      },
    });

  return {
    canShare,
    canInvite,
    setBotAccess,
    setBotConnectionAccess,
    setCanCreateRooms,
    invite,
    remove,
  };
}
