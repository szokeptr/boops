import type { EnvironmentMember } from "@t3tools/contracts";

import { RelativeTime } from "../RelativeTime";

/** "Invited" until their first connection, then "Active, last seen 5m ago". */
export function MemberStatus({ member }: { readonly member: EnvironmentMember }) {
  if (member.status === "invited") return "Invited";
  return (
    <>
      Active
      <LastSeen member={member} prefix=", " />
    </>
  );
}

export function LastSeen(props: { readonly member: EnvironmentMember; readonly prefix: string }) {
  const { lastConnectedAt } = props.member;
  if (lastConnectedAt === null) return null;
  return (
    <>
      {props.prefix}last seen <RelativeTime timestamp={lastConnectedAt} />
    </>
  );
}
