# Boops

Little bots that live on your machine.

Boops is an open-source, self-hosted app for running one or many persistent personal bots on your own computer or VPS. Each bot has a name, a persona, a home folder with memory notes it keeps itself, and routines that run on a schedule or from a webhook. Each bot lives in one long conversation that you can pick up from the web, desktop, or mobile app, with push notifications when it needs you.

New bots hatch: their first conversation is the bot interviewing you and writing its own persona.

Bots are powered by the Claude Code or Codex subscription you already have. Boops does not resell tokens.

Website: [getboops.com](https://getboops.com)

## A bot is a folder

A bot's persona and the notes it keeps are plain Markdown in its home folder. Back it up, grep it, move it to another box.

## Installation

> [!WARNING]
> Install and authenticate at least one provider before use:
>
> - Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`
> - Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
>
> Cursor, Grok Build, OpenCode, Antigravity and fx work too. See [Install and first run](./docs/user/install.md#providers).

### Command line

```bash
npx boops
```

That starts the server and opens the local web app. Once installed, `boops service install` keeps it running in the background, `boops update` moves to a newer release, and `boops --help` has the full reference.

### Desktop and mobile

Get the desktop app from [getboops.com/download](https://getboops.com/download). The mobile app connects to any Boops server; see [Install and first run](./docs/user/install.md#mobile-app).

## Some notes

Boops is very early. Expect bugs.

## Documentation

Full docs live in [docs/](./docs). There's no docs site yet.

- [FAQ](./docs/user/faq.md)
- [Install and first run](./docs/user/install.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Keyboard shortcuts](./docs/user/keybindings.md)
- [Project settings](./docs/user/project-settings.md)
- [Appearance preferences](./docs/user/appearance.md)
- [Remote access from a phone or another machine](./docs/user/remote-access.md)
- [Connect Claude Code, Codex, ChatGPT and other agents over MCP](./docs/user/outside-agents.md)
- [Keeping app and server in sync](./docs/user/updating.md)
- Multiple accounts: [Codex](./docs/user/providers-codex.md) · [Claude](./docs/user/providers-claude.md)
- [Run Boops as a background service](./docs/user/background-service.md)

Building from source? Start at [docs/internals/overview.md](./docs/internals/overview.md).

## Building from source

### Install `vp`

Boops uses Vite+ so you'll need to install the global `vp` command-line tool.

#### macOS / Linux

```bash
curl -fsSL https://vite.plus | bash
```

#### Windows

```bash
irm https://vite.plus/ps1 | iex
```

Check out their getting started guide for more information: https://viteplus.dev/guide/

### Install dependencies

```bash
vp i
```

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before reporting a bug or opening a PR.
