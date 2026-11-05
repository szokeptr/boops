# Issue tracker: Linear

Issues and specs for Pocks live in Linear, team **Pocks** (key `PCK`, issues look like `PCK-12`). Use the Linear MCP tools (`mcp__mcpgw__linear__*`).

Never file issues on GitHub. `origin` still points at upstream `pingdotgg/t3code`, which is a third party's repo, not ours.

## Conventions

- **Create an issue**: `save_issue` with `team: "PCK"`, `title`, `description` (Markdown, literal newlines). Add `labels` (`Feature`, `Improvement`, `Bug`, plus triage labels) and `project` when one fits.
- **Read an issue**: `get_issue` with the identifier (`PCK-12`), then `list_comments` for the conversation.
- **List issues**: `list_issues` with `team: "PCK"` and filters such as `state`, `label`, `assignee`, `parentId`, `query`.
- **Comment on an issue**: `save_comment` with the issue identifier and body.
- **Apply / remove labels**: `save_issue` with `id` and `addLabels` / `removeLabels`. Don't pass `labels`, which replaces the whole set.
- **Change state**: `save_issue` with `id` and `state`. Team states: Backlog, Todo, In Progress, In Review, Done, Canceled, Duplicate.
- **Close**: post the reason with `save_comment`, then `save_issue` with `state: "Done"`, or `"Canceled"` for won't-do, or `duplicateOf` for duplicates.

Group related work into fewer, topical issues rather than many tiny ones.

## When a skill says "publish to the issue tracker"

Create a Linear issue in team `PCK`.

## When a skill says "fetch the relevant ticket"

Run `get_issue` with the identifier, then `list_comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a parent issue and the tickets are its **sub-issues**.

- **Map**: an issue labelled `wayfinder:map` that holds the Notes / Decisions-so-far / Fog body.
- **Child ticket**: an issue with `parentId` set to the map and the label `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`).
- **Blocking**: Linear's native relations. Pass `blockedBy: ["PCK-n"]` to `save_issue`. A ticket is unblocked when every blocker is Done or Canceled.
- **Frontier query**: `list_issues` with `parentId: <map>`. Drop completed or canceled issues, issues with an open blocker (check with `get_issue`), and assigned ones. The first remaining issue in map order wins.
- **Claim**: `save_issue` with `id` and `assignee: "me"`, plus `state: "In Progress"`. Do this before any other write in the session.
- **Resolve**: `save_comment` with the answer, then `save_issue` with `state: "Done"`. Then use a `patch` to append a context pointer (gist and link) to the map's Decisions-so-far.
