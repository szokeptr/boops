# Connectors

A connector is a remote MCP server (Streamable HTTP) a bot can use, such as Linear or Notion. A
_connection_ is one signed-in instance of it in an environment; the user turns connections on per
bot (`Project.connectionIds`). Code: [`apps/server/src/connectors/`](../../apps/server/src/connectors/).

## Credentials never leave the server

Providers do not get third-party tokens. `ProviderSessionManager` injects each turned-on, connected
connection as an MCP server whose URL is this server's proxy, `/mcp-connectors/<serverName>`,
authenticated with the thread's own `boops` MCP credential. The proxy
([`ConnectorHttp.ts`](../../apps/server/src/connectors/ConnectorHttp.ts)) checks that the
connection is on for the calling thread's bot, adds the stored credential, and streams the answer
back. So:

- Tokens stay out of provider argv, config files, env and logs, and an agent cannot read them.
- Refresh is transparent: the proxy refreshes an OAuth token within a minute of expiry, and once
  after an upstream 401. A refused refresh marks the connection `needs_auth`.
- Turning a connection off, disconnecting or removing it cuts access at once, even for a session
  that still lists the server.
- The proxy strips `WWW-Authenticate`, or provider CLIs would start their own OAuth.

Tokens, client secrets and API keys live in `ServerSecretStore` (`connector-<id>`). Dynamic client
registrations are cached per authorization server and redirect URI
(`connector-client-<hash>`). Metadata lives in the `connector_connections` table.

An authorization server without dynamic registration (Google) fails `startOAuth` with
`oauth_client_required`, and the client asks the user for an OAuth client they created. That client
is stored in the connection's own credential, marked `userProvided`, and survives Disconnect. A new
connection to the same issuer reuses the newest such client, so one Google client serves every
Google connector.

Agents cannot turn connections on. `connectionIds` is not in `ProjectUpdatePayload`, so
`boops_project_update` and `projects.mutate` cannot set it; only the `Connectors` service writes it,
behind `settings:write` RPCs or the user's answer to a connection card.

## Redirect origins

The client passes the environment's HTTP origin as it reaches it, and the server registers
`<origin>/oauth/connectors/callback`. That is the origin of the T3 server, not of the page: on
app.t3.codes it is the environment's T3 Connect hostname or LAN address. The callback needs no
session; the single-use `state` (15 minutes, in memory) is the credential, so a server restart
drops sign-ins in progress.

- Loopback (`http://localhost:<port>`, desktop and `npx t3` on the same machine) and https origins
  (T3 Connect hostnames) work with every catalog server.
- Plain `http://` on a LAN or tailnet address is refused by most authorization servers at client
  registration. Sign in from the machine itself or through T3 Connect instead.
- Each distinct origin gets its own client registration, and a connection signed in through one
  origin refreshes without it.
- A user's own OAuth client works only from the origins whose redirect URI they registered with
  the provider. The client form shows the URI for the origin in use.

## Changes reach the next turn

`ProviderSessionManager.open` runs at every turn start and rewrites the thread's
`McpProviderSessionConfig.connectors` from `ConnectorServers.forThread`. Adapters compare
`connectorServersKey` with what their live session registered and re-register or restart where the
provider fixes MCP servers at session start. The card's wake message says the tools arrive "from
your next turn" for that reason.

## Connection cards

`connection_request` follows `link_request`: the bot asks without waiting
(`request_connection` returns `card_shown`), the card waits on the user until they write in the
thread again, and the answer arrives as a notification that wakes the bot. The record is final once
answered; clients show live connection status from `connectors.subscribe`, not from the card.

## Per-provider limits

| Provider                   | Connectors                            | A changed set reaches the next turn by                    | Provider-native MCP config                                                                    |
| -------------------------- | ------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Claude                     | HTTP servers beside `boops`           | `setMcpServers` on the live query                         | Off: `strictMcpConfig` and `ENABLE_CLAUDEAI_MCP_SERVERS=false`                                |
| Codex                      | `mcp_servers.<name>` in thread config | Unsubscribe and resume the thread (after background work) | Off: `features.apps=false`, and servers `config/read` reports for the cwd get `enabled=false` |
| Cursor                     | Sent with every turn                  | Sent every turn                                           | On: no MCP-only switch; dropping `settingSources` would also lose rules and skills            |
| OpenCode v1                | `mcp.add` per session                 | Add or `mcp.disconnect` at turn start                     | Off: other servers are disconnected at open                                                   |
| OpenCode v2                | Per-thread servers with allow rules   | Re-added every turn                                       | On: the server is shared across threads                                                       |
| ACP (Grok, Kiro, registry) | All three MCP transports              | Session reload or resume when the flavor supports it      | On: ACP has no switch                                                                         |
| Muse, Pi                   | Session config / extension env        | Only the next session; neither updates MCP live           | On: no switch                                                                                 |

Launch-argument MCP servers survive everywhere: the user chose them for T3 itself.
