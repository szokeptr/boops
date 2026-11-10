# Rooms front one hidden thread per bot

A room is a group chat on one environment: the owner, members, and bots. Everything else in Boops
assumes a thread has one provider session and at most one member. Authorship, the member fence
([ADR 0001](0001-members-fence-reads-per-bot.md)), push targeting and runtime access are all read
from `thread.linkOrigin`. A room breaks every one of those, so it is not a thread.

**The room is its own small store.** It holds participants and a plain message log with a sender
on every message. Room reads are fenced by the participant list, not by `linkOrigin`. The owner
sees rooms they are in, plus title and participants of every room so they can delete one.

**Each bot answers in a hidden thread of its own project**, `room:<roomId>:<projectId>`. It is an
ordinary thread, so persona, notes, Connections, compaction and rollover work unchanged, and it
lists as background work, like routine threads, under the room's current name. The room service
hands it messages and copies its replies back to the room. Replies are keyed by the source message
id, so copying is idempotent and catches up after a restart. Files people send are filed under the
room, not a bot thread, so deleting a bot never takes them out of the chat; deleting the room
deletes them and its hidden threads, whose files are the bots' replies.

**A bot takes a turn only when @mentioned.** Messages it was not mentioned in cost nothing. They
ride along, as a transcript, on the next message that mentions it, from a per-bot cursor. Bots
mentioning bots start turns too, at most three bot-started turns per human message.

**A turn runs at the access of the human who started it.** Access is fixed per thread elsewhere,
so the room service runs one turn at a time per room thread, records whose turn it is, and sets the
thread's runtime mode before each, from the owner's full access or the member's `access`. The MCP
tool fence asks the room whom a room thread's work is for, where other threads answer with their
`linkOrigin`: a member's turn, and work it starts, is fenced exactly as her own conversation, and
work the room cannot place in the turn it is running is refused. A bot-started turn inherits the
human at the start of its chain, and so does a bot posting into another room from a room turn,
which also keeps counting hand-offs. Merging two people's mentions into one next turn, the turn
takes the less trusted of the two; at the same runtime mode that is the member.

**One provider session serves every human's turns, so nothing may carry between them.** Approvals
in a room are once-only: a grant for the session would let a later turn, started by someone less
trusted, skip the question. Native background work (a subagent or command left running) outlives
its run and calls tools as whatever turn the thread runs next, which the room cannot tell apart.
So while the thread reports such work, a new turn runs with the lesser trust of its human and the
previous turn's human. That holds only as far as the provider reports background work.

**Anyone in the room can stop a bot.** Stopping ends the room's turn at once, drops a queued next
turn, and interrupts the run; a late reply is not posted and late tool calls are refused. A human
who leaves or is removed takes the turns they started the same way, since nobody could answer
their bot's requests and the work would go on at their access. The room says each such change in
a system note. Notes never reach phones or make a room unread, and bots read them in the
transcript as the room speaking.

**Connections follow the room, not the turn.** A provider session loads its Connections once, and
whatever a bot reads through one lands in front of everyone. So while a room has any member, its
bots reach only the Connections the owner shared with members, as in a member's own conversation.

**A request in a room belongs to whoever started the turn.** A bot's approval or question waits
for the person whose message started that turn, and the owner, when in the room, may always
answer. A run that is not the room's turn has no requests in the room; stopping the bot clears it.
The room tracks open requests from `runtime-request.updated` on its threads, so clients never read
a room thread.

## Consequences

- A member may create rooms only when the owner allows it, and may add only bots shared with them
  and people who are already members. Rooms never grant a bot to anyone. Only the owner removes the
  owner from a room.
- A bot's 1:1 conversation with the owner stays private. Room threads get the member-style
  privacy header, worded for a room.
- Calls stay 1:1. Rooms on different environments, and bots from other owners, are out of scope.
