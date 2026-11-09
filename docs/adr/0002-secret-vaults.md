# Secrets a bot keeps live in vaults the user grants per bot

`request_secret` hands a value over once: a one-use `secretRef` or an owner-only file, both gone
after 24 hours. A personal assistant needs standing credentials, and its routines run when no one
is there to answer a card. So a secret can also be kept, but only in a **vault**, and only where the
user put it.

**Vaults are separate from bots, and granted to them.** A vault is a named set of entries in an
environment. The user turns vaults on per bot in Settings, as with connections. One bot's private
vault and a household vault that several bots use are the same mechanism. Keeping secrets on the
bot itself would allow no sharing, and a single environment-wide store would hand every bot every
token. Grants live with the vault (`secret_vault_bots`), not on `Project`, so the event-sourced
project model and every client's project shape stay as they were.

**Only the user puts a secret in a vault or grants one.** An agent asks with `request_secret` and a
`name`. Keeping the value is a choice on the card, or an entry added in Settings. No agent-facing
tool or project update grants a vault, for the same reason `connectionIds` is not in
`ProjectUpdatePayload`.

**Entries are used through the existing delivery, by name.** A `request_secret` for a name the bot
can reach returns at once, as a fresh one-use `secretRef` or a file, with no card. Agents and
routines keep one way to get a secret, and a kept value is never shown in a turn either. Agents can
list names and labels, never values.

## Consequences

- A kept value is readable by any command a granted bot runs, for as long as it is kept, and an
  agent can still print it. The defenses are scoping per bot, the user's choice to keep it, and
  showing in Settings when each entry was last used. Proxying every call so values never reach the
  agent is the connectors model, and it is too heavy for arbitrary tokens.
- Entries don't expire. A value that stops working is replaced through `request_secret` with
  `replace: true`, or in Settings. Delete is the way out.
- Values live in `ServerSecretStore` (`vault-entry-<id>`) for now. Entries backed by 1Password
  references come later and keep the same model.
- Only the owner's conversations use vaults for now. Member conversations need a per-bot member
  grant like `memberConnectionIds` (see ADR 0001) before they can.
