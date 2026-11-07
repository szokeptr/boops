# FAQ

## Is Boops a harness?

No. A harness is what turns an LLM into an agent: it gives the model tools, a way to call them, runs them, and hands the results back. Claude Code is kind of a harness. It is an interface (the TUI, the Code tab in the desktop app) plus a harness underneath (the Anthropic Agent SDK). Codex is the same split: the app plus the Codex App Server. Boops uses those harnesses. It is not a harness, and it does not work without one.

Chef = LLM. Kitchen = harness. Boops = the restaurant that lets you bring whatever kitchen you want. Our MCP is a cookbook we hand the kitchen, but the chef won't open it unless you tell them to :)

Bring your own: Claude Code, Codex, Cursor, Grok Build, OpenCode, Google Antigravity, Pi, or Muse Code. [Provider setup](./install.md#providers)

## Why use Boops instead of Claude Code or the Codex app?

Claude Code and Codex are built for sessions you start and finish. Boops is for bots that stick around:

- Each bot has a persona, a home folder with notes it keeps itself, and routines that run on a schedule or from a webhook.
- One long conversation per bot, which you pick up from the web, desktop, or mobile app, with push notifications when it needs you.
- Bring your own sub. Claude, Codex, and whatever else you already have installed.
- Open source (MIT). If we go the wrong direction, fork it.

[Install](./install.md)

## Can I use Boops with my Claude Code subscription?

Yes.

## How much does Boops cost?

Nothing. You bring your own sub. It is free and open source (MIT). You still pay your provider like you already do. Boops Connect is free too, for now. Every account can connect up to 3 machines running Boops. Phones and browsers that connect to them do not count. If you hit limits or have issues, you can always fork it, self host, or use Tailscale. [Install](./install.md)

## Can I connect more than 3 machines with Boops Connect?

Not through Boops Connect. Remove a machine you no longer use, or reach the extra ones over Tailscale or LAN pairing, which have no machine limit. [Machine limit](./remote-access.md#machine-limit)

## Why is my Claude 5-hour limit draining so fast?

Boops drives Claude through Anthropic's Agent SDK. Agent SDK usage has been [reported](https://x.com/theo/status/2114166439813017873) to drain 5-hour limits faster than using Claude Code directly. Weekly limits are not affected. The fix is on Anthropic's side.

## How do I use Boops remotely?

Your agents run wherever Boops runs: your desktop, a server, a VPS. You connect to it from anywhere. Run `npx boops-cli up` on that machine and you get really good remote support. Boops Connect is the easy path. LAN pairing and Tailscale work too, and [app.getboops.com](https://app.getboops.com) is the web client. [Remote access](./remote-access.md)

## How do I use Boops on my phone?

Boops is not in the App Store or Google Play yet. The iPhone app is in a TestFlight beta. Once installed, connect it to your computer with Boops Connect or a pairing link. The phone is a remote. Your computer does the work and needs to stay on. [Mobile setup](./install.md#mobile-app) · [Remote access](./remote-access.md)

## Why does Boops Connect keep disconnecting?

Boops Connect is our built-in alternative to Tailscale for remote connections. If it keeps dropping, open **Settings > Environments**, find the machine, and select **Details**. The first part marked as failed is the cause. Tailscale makes a good fallback. [Boops Connect troubleshooting](./t3-connect-troubleshooting.md)

## Will I get banned for using my subscription?

Boops runs each provider's own CLI or SDK, signed in with your account, the same way you would run it in a terminal. It does not share, pool, or resell accounts. Each provider sets its own terms, so check them if you are unsure.

## Can I add a bunch of accounts for one provider?

Boops does not manage a pile of accounts. An automatic account switcher would put users at risk of breaking provider terms.

A separate work account is fine. Setup for two: [Codex](./providers-codex.md#use-multiple-accounts) · [Claude](./providers-claude.md#separate-accounts-or-configurations). For a bigger pool, manage them outside Boops with a self-hosted proxy like [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI). Pooling accounts may break your provider's terms. After you set up a hub, Boops can show its pooled limits under Usage. [Connect a hub](./usage.md#connect-a-cliproxyapi-hub)

## Can I use an API key or OpenRouter instead of a subscription?

Yes. Add another provider instance in Settings and give it its own keys and endpoint. Claude has a full OpenRouter recipe. Your subscription setup stays untouched. [OpenRouter](./providers-claude.md#openrouter) · [Provider instances](./install.md#providers)

## Does Boops support local models?

Not officially. Boops is tested with the hosted models its providers offer.

## Does my code go to Boops servers?

No. Your code and prompts go from your machine to your provider (Anthropic, OpenAI, etc.), not to us. With Boops Connect, traffic rides a Cloudflare tunnel (`cloudflared` on your machine). Our relay sets up the link. It does not proxy your HTTP or WebSocket sessions. Boops does send basic product usage events (provider, model, token totals, that kind of thing). No prompts, no file contents. That is the same on Tailscale, LAN, or Boops Connect. Set `T3CODE_TELEMETRY_ENABLED=false` if you want it off. [Product usage data](./telemetry.md)

## Worktrees are eating my disk. How do I clean them up?

Open **Settings > Storage** and turn on automatic worktree cleanup. You can also run it now from there. Worktrees add up fast. [Storage cleanup](./project-settings.md#storage-cleanup)

## Is there voice input?

On iPhone, yes. You need iOS 26 or later. Tap the mic in the composer, talk, check the text, then send. Web, desktop, and Android do not have it yet. [Voice input on iPhone](./composer.md#voice-input-on-iphone)

## Does it work on Windows, Mac, and Linux?

Yes, all three. Desktop app, CLI, the works. One catch: there is no `boops` binary for Intel Macs, so use the desktop app there. Windows folks can also run agents inside WSL. [Install](./install.md)

## Why is my provider not showing up?

Almost always, the CLI is not installed or not on the `PATH` of the machine that runs the server. (Not your phone. The computer.) Log in on that machine first, like `codex login` or `claude auth login`. Still missing? Point **Binary path** at it in provider settings. Version managers love to cause this one. [Provider setup](./install.md#providers)
