import { useAtomValue } from "@effect/atom-react";
import { createMemberEnvironmentAtoms } from "@t3tools/client-runtime/state/members";
import type { EnvironmentId, EnvironmentMember } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../connection/runtime";
import { environmentAtomList, environmentIdsKey } from "./environmentAtomList";
import { useEnvironments } from "./environments";
import { useEnvironmentQuery } from "./query";

export const memberEnvironment = createMemberEnvironmentAtoms(connectionAtomRuntime);

const NO_MEMBERS: ReadonlyArray<EnvironmentMember> = [];

/** Whether this session may invite people and share bots on the environment. */
export function useCanManageMembers(environmentId: EnvironmentId | null): boolean {
  return useAtomValue(memberEnvironment.setBotAccess.permissionAtom(environmentId));
}

/**
 * The environment's members, live from `members.subscribe`. Only sessions that may manage members
 * subscribe, so a read-only or member session never opens an owner-only stream.
 */
export function useMembers(environmentId: EnvironmentId | null) {
  const allowed = useCanManageMembers(environmentId);
  const query = useEnvironmentQuery(
    environmentId === null || !allowed
      ? null
      : memberEnvironment.members({ environmentId, input: {} }),
  );
  return {
    allowed,
    members: query.data?.members ?? NO_MEMBERS,
    canInvite: query.data?.canInvite ?? false,
    loaded: query.data !== null,
    error: query.data === null ? query.error : null,
  };
}

const sessionMembersAtom = environmentAtomList(
  "web-environment-session-members",
  memberEnvironment.sessionMemberAtom,
);

/** The environments this client reaches as an invited member, not their owner. */
export function useMemberEnvironmentIds(
  environmentIds: ReadonlyArray<EnvironmentId>,
): ReadonlySet<EnvironmentId> {
  const sessionMembers = useAtomValue(sessionMembersAtom(environmentIdsKey(environmentIds)));
  return new Set(environmentIds.filter((_, index) => sessionMembers[index] != null));
}

/** Every connected environment is someone else's, shared with this client as a member. */
export function useIsMemberOnly(): boolean {
  const environmentIds = useEnvironments().environments.map(
    (environment) => environment.environmentId,
  );
  const memberEnvironmentIds = useMemberEnvironmentIds(environmentIds);
  return environmentIds.length > 0 && memberEnvironmentIds.size === environmentIds.length;
}

/**
 * "Shared with Anna", "Shared with Anna and Ben", "Shared with Anna and 2 others", or a count
 * while the names haven't loaded. Null when the bot isn't shared.
 */
export function botSharedWithLabel(
  project: { readonly memberIds?: ReadonlyArray<string> | undefined } | undefined,
  members: ReadonlyArray<EnvironmentMember> | null,
): string | null {
  const memberIds = project?.memberIds ?? [];
  if (memberIds.length === 0) return null;
  const names = (members ?? [])
    .filter((member) => memberIds.includes(member.id))
    .map((member) => member.label);
  const [first, second] = names;
  if (first === undefined) {
    return `Shared with ${memberIds.length} ${memberIds.length === 1 ? "person" : "people"}`;
  }
  if (second === undefined) return `Shared with ${first}`;
  if (names.length === 2) return `Shared with ${first} and ${second}`;
  return `Shared with ${first} and ${names.length - 1} others`;
}
