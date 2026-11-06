import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  EnvironmentMember,
  MembersInviteInput,
  MembersSetBotAccessInput,
  MembersSetBotConnectionAccessInput,
} from "@t3tools/contracts";

import { memberEnvironment } from "../../state/members";
import { useAtomCommand } from "../../state/use-atom-command";
import { toastManager } from "../ui/toast";

function reportFailure(title: string, result: AtomCommandResult<unknown, unknown>) {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
  const error = squashAtomCommandFailure(result);
  toastManager.add({
    type: "error",
    title,
    description: error instanceof Error ? error.message : "An error occurred.",
  });
}

/**
 * Sharing, inviting and removing, for the Share dialog and Settings → Members. Every change comes
 * back through `members.subscribe` and the bots' project shells, so nothing here refreshes.
 */
export function useMemberCommands(environmentId: EnvironmentId) {
  const quiet = { reportFailure: false } as const;
  const runSetBotAccess = useAtomCommand(memberEnvironment.setBotAccess, quiet);
  const runSetBotConnectionAccess = useAtomCommand(memberEnvironment.setBotConnectionAccess, quiet);
  const runInvite = useAtomCommand(memberEnvironment.invite, quiet);
  const runRemove = useAtomCommand(memberEnvironment.remove, quiet);
  return {
    setBotAccess: async (input: MembersSetBotAccessInput) => {
      const result = await runSetBotAccess({ environmentId, input });
      reportFailure(input.enabled ? "Could not share the bot" : "Could not stop sharing", result);
    },
    setBotConnectionAccess: async (input: MembersSetBotConnectionAccessInput) => {
      const result = await runSetBotConnectionAccess({ environmentId, input });
      reportFailure(
        input.enabled ? "Could not share the connection" : "Could not stop sharing it",
        result,
      );
    },
    invite: async (input: MembersInviteInput): Promise<boolean> => {
      const result = await runInvite({ environmentId, input });
      reportFailure(`Could not invite ${input.label}`, result);
      if (result._tag !== "Success") return false;
      toastManager.add({
        type: "success",
        title: `Invited ${input.label}`,
        description: `They'll see the invite when they sign in to Boops Connect as ${input.email}.`,
      });
      return true;
    },
    remove: async (member: EnvironmentMember): Promise<boolean> => {
      const result = await runRemove({ environmentId, input: { memberId: member.id } });
      reportFailure(`Could not remove ${member.label}`, result);
      return result._tag === "Success";
    },
  };
}
