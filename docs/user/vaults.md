# Vaults

When a bot asks for a secret in a card, such as an API token, the value is normally used once:
the bot gets it for the task at hand, and the server deletes it within a day. A secret a bot needs
again, for example a Home Assistant token its routines use every morning, can be kept in a
**vault** instead, so the bot doesn't have to ask each time.

## Keep a secret

When a bot asks for a secret it will need again, the card shows **Keep for <bot> as `<name>`**,
turned on. Leave it on to keep the value. Turn it off to use it once.

- The first secret a bot keeps creates a vault named after the bot.
- If the bot can use several vaults, choose which one keeps it.
- Next time, the bot gets the value without asking. A bot that finds a kept value stopped working
  asks again, and saving replaces it.

A kept value never appears in the chat, but the bot's commands can read it, for as long as it is
kept.

## Manage vaults

Open **Settings → Vaults**. The same page is in the mobile app under Settings.

- **New vault** makes an empty one. A vault several bots use, for example a household one, lets
  them share secrets.
- **Choose bots** sets which bots can use a vault. A bot's own settings page has the same switches.
- Each secret shows when a bot last used it. You can add one by hand, replace its value, or remove
  it. Deleting a vault removes its secrets from the server.

Only you keep secrets and choose which bots use a vault; a bot can't do either itself. In
conversations with people you share a bot with, the bot doesn't use vaults.
