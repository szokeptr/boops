# Members are fenced on reads and granted per bot

Upstream T3 Code has one owner per environment. Everything else that reaches it, a paired device, a
linked environment's agents, an outside MCP client, acts for that owner: sessions carry
environment-wide scopes, and a link-origin fence limits which work a link may _change_ but lets it
read everything. Members break both rules on purpose, because a member is a different person, not
another device of the owner's.

**Member reads are fenced.** A member sees only their own threads (`linkOrigin.memberId`) in bots
shared with them, in shell snapshots, live events, thread reads, search and MCP tools alike. The
owner's shell, in turn, hides member threads. Fencing only writes would show a partner every thread
on the machine.

**Member grants are per bot.** Access is `Project.memberIds`, not a scope. Scopes stay
`orchestration:read` and `orchestration:operate`, and a member policy that every RPC must name
decides what those scopes reach. A scope cannot say "this bot and not that one", and widening the
scope vocabulary would leak into every client's permission checks.

## Consequences

- Fork merges touch the shell, thread-read, dispatch and MCP paths where upstream assumes one
  reader. New RPCs fail to compile until the member policy names them.
- `linkOrigin` is reused rather than adding a second origin, so forks, subagents and
  `create_threads` inherit membership with no new plumbing. The member fence compares `memberId`,
  not `sessionId`, because a member's devices each get their own session.
