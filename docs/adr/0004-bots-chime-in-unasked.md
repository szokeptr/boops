# Bots chime in unasked, one at a time

Group chats used to wake a bot only on an @mention ([ADR 0003](0003-rooms-front-per-bot-threads.md)),
so a follow-up such as "and hotels?" needed a fresh mention. Now, a few seconds after a burst of human
messages that mention nobody, one call to OpenAI's Decisions API scores every listening bot in the
room, and the likeliest one, if likely enough, takes a turn. The pattern follows eve's ambient
listening: a cheap filter that lets doubt through, then the bot's own model decides, and it can end
the turn with `stay_quiet`.

**One call per burst, not one per bot.** A filter per bot would cost more with every bot added and
would wake several bots for the same question. One request with a yes/no question per bot keeps the
cost flat and lets the room wake at most one. A bot that thinks another fits better @mentions it, so
hand-offs reuse the hop limit instead of a second wake path.

**The bot that just spoke owns the follow-up.** It wins ties, and when the Decisions call fails or
times out it is the only bot woken. Failing open to every bot, as a single-agent filter does, would
start a pile-on.

**Being specific keeps others out.** A message that @mentions anyone cancels the pending wait, so no
bot chimes in on what came before it. Only human messages start a wait; bots never wake bots this
way.

**An unasked turn runs for the least trusted human in the burst**, as merged mentions do, and its
guidance says not to change anything nobody asked for. It shows no typing row until it posts:
most unasked turns end quietly, and a typing row that comes to nothing is a lying spinner.

## Consequences

- Recent group chat messages go to OpenAI under the owner's key, the one bot calls already use.
  Without a key, rooms behave as before.
- Bots listen by default. Whoever manages a room turns listening off per bot or says what it is
  there for; that text reaches both the decision model and the bot, so only people write it.
- The wait and the people it covers live in memory. A restart drops a pending wait, which costs at
  most one missed chime-in.
