import * as Schema from "effect/Schema";

import {
  ConnectorConnectionId,
  IsoDateTime,
  ProjectId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { AuthMcpClientAccess } from "./auth.ts";

/**
 * A member is a person the owner invited to chat with some of their bots. They sign in to Boops
 * Connect, accept, and reach this environment through their own link. A member's sessions carry
 * `memberSessionSubject(id)`, so authorization knows who they are; see `docs/internals/members.md`.
 */
export const EnvironmentMemberId = TrimmedNonEmptyString.pipe(Schema.brand("EnvironmentMemberId"));
export type EnvironmentMemberId = typeof EnvironmentMemberId.Type;

const MEMBER_SUBJECT_PREFIX = "member:";

export const memberSessionSubject = (memberId: EnvironmentMemberId) =>
  `${MEMBER_SUBJECT_PREFIX}${memberId}`;

export const memberIdFromSessionSubject = (subject: string): EnvironmentMemberId | undefined =>
  subject.startsWith(MEMBER_SUBJECT_PREFIX) && subject.length > MEMBER_SUBJECT_PREFIX.length
    ? EnvironmentMemberId.make(subject.slice(MEMBER_SUBJECT_PREFIX.length))
    : undefined;

/** A member's turns never run above this; the bot's own mode is narrowed to it. */
export const MemberAccess = AuthMcpClientAccess;
export type MemberAccess = typeof MemberAccess.Type;
export const DEFAULT_MEMBER_ACCESS: MemberAccess = "auto-accept-edits";

export const EnvironmentMemberStatus = Schema.Literals(["invited", "active"]);
export type EnvironmentMemberStatus = typeof EnvironmentMemberStatus.Type;

export const EnvironmentMember = Schema.Struct({
  id: EnvironmentMemberId,
  /** What the owner calls them, e.g. "Anna". */
  label: TrimmedNonEmptyString,
  email: TrimmedNonEmptyString,
  access: MemberAccess,
  /** Whether they may start group chats, with the bots shared with them. */
  canCreateRooms: Schema.Boolean,
  /** `invited` until their first connection. */
  status: EnvironmentMemberStatus,
  createdAt: IsoDateTime,
  lastConnectedAt: Schema.NullOr(IsoDateTime),
});
export type EnvironmentMember = typeof EnvironmentMember.Type;

export const MembersSnapshot = Schema.Struct({
  members: Schema.Array(EnvironmentMember),
  /** Inviting needs Boops Connect: members arrive through it. */
  canInvite: Schema.Boolean,
});
export type MembersSnapshot = typeof MembersSnapshot.Type;

export const MembersInviteInput = Schema.Struct({
  email: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  /** Bots to share right away. */
  projectIds: Schema.Array(ProjectId),
  access: Schema.optionalKey(MemberAccess),
});
export type MembersInviteInput = typeof MembersInviteInput.Type;

export const MembersUpdateInput = Schema.Struct({
  memberId: EnvironmentMemberId,
  label: Schema.optionalKey(TrimmedNonEmptyString),
  access: Schema.optionalKey(MemberAccess),
  canCreateRooms: Schema.optionalKey(Schema.Boolean),
});
export type MembersUpdateInput = typeof MembersUpdateInput.Type;

export const MembersRemoveInput = Schema.Struct({ memberId: EnvironmentMemberId });
export type MembersRemoveInput = typeof MembersRemoveInput.Type;

/** Mirrors `connectors.setBotConnection`: one bot, one member, on or off. */
export const MembersSetBotAccessInput = Schema.Struct({
  projectId: ProjectId,
  memberId: EnvironmentMemberId,
  enabled: Schema.Boolean,
});
export type MembersSetBotAccessInput = typeof MembersSetBotAccessInput.Type;

/**
 * Whether the people a bot is shared with may use one of its Connections. A Connection is the
 * owner's account, so each one is off for members until the owner turns it on for that bot.
 */
export const MembersSetBotConnectionAccessInput = Schema.Struct({
  projectId: ProjectId,
  connectionId: ConnectorConnectionId,
  enabled: Schema.Boolean,
});
export type MembersSetBotConnectionAccessInput = typeof MembersSetBotConnectionAccessInput.Type;

const MEMBERS_ERROR_MESSAGES = {
  "not-found": "That person is not a member of this environment.",
  "already-member": "That email already has an invite.",
  "connect-required": "Turn on Boops Connect to invite people.",
  "relay-unavailable": "Could not reach Boops Connect. Try again.",
  "not-a-bot": "Only bots can be shared.",
  "connection-off": "Turn this Connection on for the bot first.",
  persistence: "Could not save the change.",
} as const;

export const MembersErrorReason = Schema.Literals(
  Object.keys(MEMBERS_ERROR_MESSAGES) as Array<keyof typeof MEMBERS_ERROR_MESSAGES>,
);
export type MembersErrorReason = typeof MembersErrorReason.Type;

export class MembersError extends Schema.TaggedError<MembersError>()("MembersError", {
  reason: MembersErrorReason,
  cause: Schema.optionalKey(Schema.Defect()),
}) {
  override get message(): string {
    return MEMBERS_ERROR_MESSAGES[this.reason];
  }
}
