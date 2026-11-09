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
lists as background work, like routine threads. The room service hands it messages and copies its
replies back to the room. Replies are keyed by the source message id, so copying is idempotent and
catches up after a restart.

**A bot takes a turn only when @mentioned.** Messages it was not mentioned in cost nothing. They
ride along, as a transcript, on the next message that mentions it, from a per-bot cursor. Bots
mentioning bots start turns too, at most three bot-started turns per human message.

**A turn runs at the access of the human who started it.** Access is fixed per thread elsewhere,
so the room service runs one turn at a time per room thread and sets the thread's runtime mode
before each, from the owner's full access or the member's `access`. A bot-started turn inherits the
human at the start of its chain.

**Connections follow the room, not the turn.** A provider session loads its Connections once, and
whatever a bot reads through one lands in front of everyone. So while a room has any member, its
bots reach only the Connections the owner shared with members, as in a member's own conversation.

**A request in a room belongs to whoever started the turn.** A bot's approval or question waits
for the person whose message started that turn, and the owner may always answer. The room tracks
open requests from `runtime-request.updated` on its threads, so clients never read a room thread.

## Consequences

- A member may create rooms only when the owner allows it, and may add only bots shared with them
  and people who are already members. Rooms never grant a bot to anyone.
- A bot's 1:1 conversation with the owner stays private. Room threads get the member-style
  privacy header, worded for a room.
- Calls stay 1:1. Rooms on different environments, and bots from other owners, are out of scope.
