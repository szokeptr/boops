# Members

A member is a person the owner invited to chat with some of their bots. They arrive only through
Boops Connect, see only the bots shared with them, and chat in their own threads. Code:
[`apps/server/src/members/`](../../apps/server/src/members/). Why reads are fenced and grants are
per bot: [ADR 0001](../adr/0001-members-fence-reads-per-bot.md).

## Identity comes from the Connect mint

The owner's invite stores a row in `environment_members` and asks the relay to hold an invite for
the email. When the invitee accepts, the relay gives them a member link to the owner's environment,
and every mint through that link carries `memberId` in the proof.
[`CloudLink.mintCredential`](../../apps/server/src/cloud/CloudLink.ts) treats a proof whose `sub` is
the linked owner as the owner, whatever else it says. Any other `sub` must name a member that still
exists. The first such mint binds that Connect user to the member, and a later mint from a
different user is refused, so an accepted invite cannot be passed on. Binding is what turns the
member from `invited` to `active`.

The mint issues a pairing link with subject `memberSessionSubject(id)` and only
`orchestration:read` and `orchestration:operate`. Every session exchanged from it carries that
subject, and the subject is the only thing that marks a session as a member's: RPC policy, shell
filtering and MCP fencing all read it
([memberFence](../../apps/server/src/members/memberFence.ts)). `auth/session` adds
`member: { id, label }` for such a session, and answers unauthenticated once the member is gone.

## A member's threads are link-origin threads

Sharing a bot (`members.setBotAccess`) adds the member to `Project.memberIds`, which only the
`Members` service writes, like `connectionIds`. It also creates the member's conversation with that
bot if they have none: a server-side `thread.create` with
`linkOrigin = { sessionId: member subject, label, access, memberId }`, the bot's title and model,
and the bot's runtime mode narrowed to the member's access. Everything that already carries
`linkOrigin` (forks, subagents, `create_threads`) carries the member with it, and a client's own
`thread.create` can never set one. `linkOrigin.access` is stamped at creation; changing a member's
access affects conversations created afterwards.

Turning a bot off only removes the member from `memberIds`. Their conversation stays and comes
back if the bot is shared again.

A bot's Connections are the owner's accounts, so a member's conversation reaches only those in
`Project.memberConnectionIds` (`members.setBotConnectionAccess`), intersected with the bot's own
`connectionIds` ([ConnectorServers](../../apps/server/src/connectors/ConnectorServers.ts)).
Turning a Connection off for the bot drops it from `memberConnectionIds` too, so turning it back on
never quietly hands it to members.

## Removing is ordered so access ends first

`members.remove` and `members.leave` delete the row before anything else, so no later mint
succeeds. Then they revoke every session with the member's subject (live sockets close), ask the
relay to drop the invite and member link, unshare every bot, and interrupt and archive the member's
threads. Steps after the session revocation are best effort: the relay call only logs on failure,
because the environment already refuses the member. Archived threads stay on disk and stay hidden
from the owner.

A managed policy that turns Boops Connect off also revokes member sessions at startup, since
members cannot arrive any other way.

## Push follows the thread's member

The agent-activity state for a member's thread carries `memberId`
([AgentAwarenessRelay](../../apps/server/src/relay/AgentAwarenessRelay.ts)). The relay delivers it
only to that member's link, and a state without `memberId` only to owner links.
