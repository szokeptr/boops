import { useAtomValue } from "@effect/atom-react";
import {
  createMemberEnvironmentAtoms,
  isMemberEnvironment,
} from "@t3tools/client-runtime/state/members";
import type { EnvironmentId, EnvironmentMember } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { useEnvironmentQuery } from "./query";
import { relayEnvironmentDiscovery } from "./relay";
import { environmentSession } from "./session";
import { workspaceConnections } from "./workspace";

export const memberEnvironment = createMemberEnvironmentAtoms(connectionAtomRuntime);

const NO_MEMBERS: ReadonlyArray<EnvironmentMember> = [];

/** The owner's members, live from `members.subscribe`. */
export function useEnvironmentMembers(environmentId: EnvironmentId | null) {
  const query = useEnvironmentQuery(
    environmentId === null ? null : memberEnvironment.members({ environmentId, input: {} }),
  );
  return {
    members: query.data?.members ?? NO_MEMBERS,
    canInvite: query.data?.canInvite ?? false,
    loaded: query.data !== null,
    error: query.data === null ? query.error : null,
  };
}

const isMemberEnvironmentAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get) =>
    isMemberEnvironment({
      session: get(environmentSession.sessionStateValueAtom(environmentId)),
      relayRole: get(relayEnvironmentDiscovery.stateValueAtom).environments.get(environmentId)
        ?.environment.role,
    }),
  ).pipe(Atom.withLabel(`mobile:is-member-environment:${environmentId}`)),
);

const EMPTY_MEMBER_ATOM = Atom.make(false);

/** Whether this device reaches the environment as someone's invited member. */
export function useIsMemberEnvironment(environmentId: EnvironmentId | null): boolean {
  return useAtomValue(
    environmentId === null ? EMPTY_MEMBER_ATOM : isMemberEnvironmentAtom(environmentId),
  );
}

const memberEnvironmentsAtom = Atom.make((get) =>
  get(workspaceConnections.environmentsAtom).filter((environment) =>
    get(isMemberEnvironmentAtom(environment.environmentId)),
  ),
).pipe(Atom.withLabel("mobile:member-environments"));

/** Every saved environment is someone else's: this device only chats with shared bots. */
const memberOnlyAtom = Atom.make((get) => {
  const environments = get(workspaceConnections.environmentsAtom);
  return (
    environments.length > 0 &&
    environments.every((environment) => get(isMemberEnvironmentAtom(environment.environmentId)))
  );
}).pipe(Atom.withLabel("mobile:member-only"));

export function useMemberOnly(): boolean {
  return useAtomValue(memberOnlyAtom);
}

/** The saved environments this device reaches as a member, for their Leave actions. */
export function useMemberEnvironments() {
  return useAtomValue(memberEnvironmentsAtom);
}
