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
  - Services that need an OAuth client of your own, such as Google's, ask for its client ID and
    secret first. See [Google Workspace](#google-workspace).
  - Open services are added straight away.
- **Add custom** takes the URL of any remote MCP server. The server is asked how it signs in.

After connecting, pick the bots that should use it. A bot gets the new tools from its next turn.

You can connect the same service more than once, for example a work and a personal account, and
rename each connection.

## Google Workspace

Gmail, Google Calendar, Drive, Docs, Sheets, Slides, Chat and Contacts are in the gallery. Google
doesn't let apps register themselves for sign-in, so you create an OAuth client in your own Google
Cloud project once, and every Google connection uses it. The servers are a Google Workspace
Developer Preview, which your account must be part of.

1. In a [Google Cloud](https://console.cloud.google.com/) project, enable the API and the MCP API
   for each product, for example **Gmail API** and **Gmail MCP API**. Contacts needs only the
   **People API**. Chat also needs a Chat app set up under **Google Chat API → Configuration**.
2. Under **Google Auth Platform**, set up the consent screen. Pick **Internal** for a Workspace
   account. Otherwise pick **External** and add yourself as a test user. Under **Data Access**, add
   the scopes the connect form lists.
3. Create an OAuth client of type **Web application**, tick **Use this client for an AI-powered
   agent**, and add the redirect URI from the connect form. It is the server's address followed by
   `/oauth/connectors/callback`, for example `http://localhost:3773/oauth/connectors/callback`.
   Add one for each address you sign in from.
4. Choose **Connect** on a Google service and paste the client ID and secret. The secret stays on
   the server.

While an External app is in **Testing**, Google ends its sign-ins after 7 days, so the connection
asks you to sign in again every week. Publishing the app under **Audience → In production** avoids
that. An app Google hasn't verified shows a warning on the sign-in page; you can continue past it.

Google's full guide: [Configure the Google Workspace MCP servers](https://developers.google.com/workspace/guides/configure-mcp-servers).

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
[Boops Connect](./remote-access.md), which uses https. API-key and open services work from anywhere.
