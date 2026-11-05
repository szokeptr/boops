# Connectors

A connector gives your bots the tools of an online service, such as Linear, Notion or a search
API. You connect a service once per machine, then turn it on for each bot that should use it. The
sign-in stays on the server: bots use the service's tools but never see the token or key.

## Connect a service

Open **Settings → Connectors**. The same page is in the mobile app under Settings.

- **Gallery** lists services you can connect. Choose **Connect**:
  - Services that sign in open their sign-in page in the browser. Finish there; the page updates
    by itself when you're done.
  - Services that use an API key ask for it, with a link to where you get one.
  - Open services are added straight away.
- **Add custom** takes the URL of any remote MCP server. The server is asked how it signs in.

After connecting, pick the bots that should use it. A bot gets the new tools from its next turn.

You can connect the same service more than once, for example a work and a personal account, and
rename each connection.

## Turn connections on per bot

A connection does nothing until a bot has it turned on. Turn it on or off in the bot's settings
under **Connectors**, or from **Turn on for…** on the connection in Settings → Connectors.

## When a bot asks

A bot can ask for a service it needs. A card appears in the conversation with its reason:

- **Connect** signs in to a new connection, or uses the one you already have.
- **Turn on for** your bot, when the service is connected but off for this bot.
- **Sign in again**, when the connection's sign-in expired.
- **Not now** declines. The bot is told and won't wait for it.

Once you answer, the bot is told and continues. The card keeps showing the connection's current
state, so it offers **Reconnect** if the connection is removed later.

## Fix or remove a connection

Each connection shows whether it works, how many tools it has and which bots use it.

- **Test** asks the service for its tools again.
- **Sign in again** replaces an expired sign-in or key.
- **Disconnect** signs out but keeps the connection on for its bots, so signing in again restores
  it everywhere.
- **Remove** deletes the connection and turns it off for every bot that used it.

## Signing in from another device

Sign-in sends your browser back to the server's own address. When you reach the server over plain
`http://` from another device, for example a LAN or Tailscale address, most services refuse the
sign-in, and the app warns you. Sign in from the machine the server runs on, or reach it through
[T3 Connect](./remote-access.md), which uses https. API-key and open services work from anywhere.
