import {
  WS_METHODS,
  type AuthSessionState,
  type EnvironmentId,
  type EnvironmentMemberId,
  type OrchestrationProjectShell,
} from "@t3tools/contracts";
import type { RelayEnvironmentLinkRole } from "@t3tools/contracts/relay";
import { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";
import { createEnvironmentSessionAtoms } from "./session.ts";

/**
 * Whether this client reaches the environment as an invited member. The session is the authority;
 * until it loads, the relay link's role answers so a member's first frame is not the owner's UI.
 */
export function isMemberEnvironment(input: {
  readonly session: Pick<AuthSessionState, "member"> | null;
  readonly relayRole: RelayEnvironmentLinkRole | undefined;
}): boolean {
  if (input.session !== null) return input.session.member !== undefined;
  return input.relayRole === "member";
}

/** Whether `project` is shared with `memberId`. */
export function isBotSharedWith(
  project: Pick<OrchestrationProjectShell, "memberIds">,
  memberId: EnvironmentMemberId,
): boolean {
  return project.memberIds?.includes(memberId) ?? false;
}

/**
 * An environment's members, for its owner. `members` follows `members.subscribe`, which sends the
 * whole list again after every change, so commands need no refresh. Which bots each member has
 * arrives as `memberIds` on the project shells.
 */
export function createMemberEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const sessions = createEnvironmentSessionAtoms(runtime);
  return {
    members: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:members",
      tag: WS_METHODS.membersSubscribe,
    }),
    invite: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:members:invite",
      tag: WS_METHODS.membersInvite,
    }),
    update: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:members:update",
      tag: WS_METHODS.membersUpdate,
    }),
    remove: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:members:remove",
      tag: WS_METHODS.membersRemove,
    }),
    setBotAccess: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:members:set-bot-access",
      tag: WS_METHODS.membersSetBotAccess,
    }),
    setBotConnectionAccess: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:members:set-bot-connection-access",
      tag: WS_METHODS.membersSetBotConnectionAccess,
    }),
    leave: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:members:leave",
      tag: WS_METHODS.membersLeave,
    }),
    /** The member this session belongs to; null for the owner and while the session loads. */
    sessionMemberAtom: Atom.family((environmentId: EnvironmentId) =>
      Atom.make((get) => get(sessions.sessionStateValueAtom(environmentId))?.member ?? null).pipe(
        Atom.withLabel(`environment-session-member:${environmentId}`),
      ),
    ),
  };
}
