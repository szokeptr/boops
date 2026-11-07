import {
  botMainThreadId,
  isBotConversationThread,
  type BotAutonomy,
  type EnvironmentId,
  type ProjectAvatar,
  type ProjectId,
  type RuntimeMode,
  type ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { scopeThreadRef, scopedProjectKey, scopedThreadKey } from "../environment/scoped.ts";
import type { EnvironmentProject, EnvironmentThreadShell } from "./models.ts";
import {
  hasUnseenCompletion,
  hasUnseenFailure,
  resolveThreadLastVisitedAt,
  resolveThreadStatus,
} from "./threadStatus.ts";
import { toSortableTimestamp } from "./threadSort.ts";

// Web and mobile read it from here; the server shares the rule through contracts.
export { isBotConversationThread };

/** What one thread of a bot is doing. */
export type BotThreadStatus = "working" | "needs-you" | "idle";

/**
 * What the bot is doing, as its avatar shows it. Hatching: it has not written its
 * PERSONA.md yet. Dozing: idle and quiet for a while.
 */
export type BotStatus = BotThreadStatus | "dozing" | "hatching";

export interface BotThreadRow {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly title: string;
  readonly status: BotThreadStatus;
  readonly unread: boolean;
  readonly lastActivityAt: string;
}

/** One tab of a bot's conversations; the main one leads. */
export interface BotConversationTab extends BotThreadRow {
  readonly main: boolean;
}

export interface BotRow {
  /** `environmentId:projectId`, unique across linked environments. */
  readonly key: string;
  readonly environmentId: EnvironmentId;
  /** Label of the machine the bot runs on, for the machine badge. */
  readonly machineLabel: string | null;
  readonly projectId: ProjectId;
  readonly name: string;
  readonly avatar: ProjectAvatar | null;
  readonly mainThreadId: ThreadId | null;
  readonly lastMessagePreview: string | null;
  readonly lastMessageFromUser: boolean;
  readonly status: BotStatus;
  readonly unread: boolean;
  readonly lastActivityAt: string;
  /** Background threads (helpers, Heartbeat), which the bot's activity view lists. */
  readonly activityThreadCount: number;
  /** Name of the bot that created this one, for the "made by" badge. */
  readonly madeBy: string | null;
  /** Pinned bots lead the list as avatars, in the order they were pinned. */
  readonly pinnedAt: string | null;
}

export interface BotListInput {
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly machineLabels: ReadonlyMap<EnvironmentId, string>;
  /** Client-kept visit watermarks by scoped thread key, for servers without visit tracking. */
  readonly localLastVisitedAt?: Readonly<Record<string, string>>;
  /** Epoch milliseconds; without it no bot dozes. */
  readonly now?: number;
}

// Rows render one line; a long reply would only be clipped by CSS.
const PREVIEW_MAX_LENGTH = 200;

// A day without a message reads as asleep on the avatar.
const BOT_DOZE_AFTER_MS = 24 * 60 * 60 * 1_000;

/** Initials of the bot's first two words, or the first two letters of a one-word name. */
export function botMonogram(name: string): string {
  // Code points, not graphemes: Hermes has no Intl.Segmenter, and initials are rarely combined emoji.
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length > 1
      ? words
          .slice(0, 2)
          .map((word) => Array.from(word)[0] ?? "")
          .join("")
      : Array.from(words[0] ?? "")
          .slice(0, 2)
          .join("");
  return letters.length === 0 ? "?" : letters.toLocaleUpperCase();
}

function isListedThread(thread: EnvironmentThreadShell): boolean {
  return thread.archivedAt === null && thread.deletedAt === null;
}

/** The bot's own live threads; project ids are only unique within an environment. */
function botThreads(
  project: Pick<EnvironmentProject, "environmentId" | "id">,
  threads: ReadonlyArray<EnvironmentThreadShell>,
): EnvironmentThreadShell[] {
  return threads.filter(
    (thread) =>
      thread.environmentId === project.environmentId &&
      thread.projectId === project.id &&
      isListedThread(thread),
  );
}

function botStatusOfThread(thread: EnvironmentThreadShell): BotThreadStatus {
  switch (resolveThreadStatus(thread)) {
    case "approval":
    case "input":
    case "request":
      return "needs-you";
    case "working":
    case "waiting":
      return "working";
    case "failed":
    case "limited":
    case "ready":
      return "idle";
  }
}

const STATUS_RANK: Record<BotThreadStatus, number> = { idle: 0, working: 1, "needs-you": 2 };

function isThreadUnread(
  thread: EnvironmentThreadShell,
  localLastVisitedAt: Readonly<Record<string, string>> | undefined,
): boolean {
  const lastVisitedAt = resolveThreadLastVisitedAt(
    thread.lastVisitedAt,
    localLastVisitedAt?.[scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))],
  );
  const input = { latestRun: thread.latestRun, lastVisitedAt };
  return hasUnseenCompletion(input) || hasUnseenFailure(input);
}

function threadActivityAt(thread: EnvironmentThreadShell): string {
  const message = thread.source.latestVisibleMessage;
  return message === null ? thread.updatedAt : DateTime.formatIso(message.updatedAt);
}

function laterIso(a: string, b: string): string {
  return (toSortableTimestamp(b) ?? 0) > (toSortableTimestamp(a) ?? 0) ? b : a;
}

// Line-start syntax first, while the newlines are still there; then inline marks.
const MARKDOWN_PREVIEW_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^\s*```[^\n]*$/gm, ""],
  [/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/gm, ""],
  [/^\s*\|?(?:\s*:?-+:?\s*\|)+\s*:?-*:?\s*$/gm, ""],
  [/^\s{0,3}#{1,6}\s+/gm, ""],
  [/^\s{0,3}(?:>\s?)+/gm, ""],
  [/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm, ""],
  [/!\[([^\]]*)\]\([^)]*\)/g, "$1"],
  [/\[([^\]]+)\]\([^)]*\)/g, "$1"],
  [/<((?:https?|mailto):[^>\s]+)>/g, "$1"],
  [/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2"],
  [/~~(?=\S)([\s\S]*?\S)~~/g, "$1"],
  [/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])/g, "$1$2"],
  [/(^|[^\w])_(?=\S)([^_\n]*?\S)_(?!\w)/g, "$1$2"],
  [/`+([^`]+?)`+/g, "$1"],
  [/\|/g, " "],
];

/** One line of plain text from a markdown message, clipped for a list row. */
export function botMessagePreview(text: string): string | null {
  let plain = text;
  for (const [pattern, replacement] of MARKDOWN_PREVIEW_RULES) {
    plain = plain.replace(pattern, replacement);
  }
  const collapsed = plain.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return null;
  return collapsed.length > PREVIEW_MAX_LENGTH
    ? `${collapsed.slice(0, PREVIEW_MAX_LENGTH - 1)}…`
    : collapsed;
}

function compareByActivity(
  a: { readonly lastActivityAt: string },
  b: { readonly lastActivityAt: string },
  tieBreak: string,
  otherTieBreak: string,
): number {
  const difference =
    (toSortableTimestamp(b.lastActivityAt) ?? 0) - (toSortableTimestamp(a.lastActivityAt) ?? 0);
  return difference !== 0 ? difference : tieBreak.localeCompare(otherTieBreak);
}

// Servers without persona tracking leave `personaReady` out; there, a first turn is the best sign.
function hasHatched(
  project: Pick<EnvironmentProject, "personaReady">,
  main: EnvironmentThreadShell | null,
): boolean {
  return project.personaReady ?? (main !== null && main.latestRun !== null);
}

/**
 * One row per bot across every linked environment, most recently active
 * first. A bot needs you or works when any of its threads does, so a
 * background run waiting on an approval still surfaces on the bot.
 */
export function deriveBotList(input: BotListInput): ReadonlyArray<BotRow> {
  const threadsByProjectKey = new Map<string, EnvironmentThreadShell[]>();
  for (const thread of input.threads) {
    if (!isListedThread(thread)) continue;
    const key = `${thread.environmentId}:${thread.projectId}`;
    const bucket = threadsByProjectKey.get(key);
    if (bucket) bucket.push(thread);
    else threadsByProjectKey.set(key, [thread]);
  }

  // Archived parents still name their children; a deleted one leaves no badge.
  const titlesByProjectKey = new Map(
    input.projects.map((project) => [
      scopedProjectKey({ environmentId: project.environmentId, projectId: project.id }),
      project.title,
    ]),
  );

  const rows: BotRow[] = [];
  for (const project of input.projects) {
    if (project.archivedAt != null || project.isScratch) continue;
    const key = scopedProjectKey({ environmentId: project.environmentId, projectId: project.id });
    const threads = threadsByProjectKey.get(key) ?? [];
    const mainThreadId = botMainThreadId(project, threads);
    const main = threads.find((thread) => thread.id === mainThreadId) ?? null;
    let threadStatus: BotThreadStatus = "idle";
    for (const thread of threads) {
      const status = botStatusOfThread(thread);
      if (STATUS_RANK[status] > STATUS_RANK[threadStatus]) threadStatus = status;
    }
    const lastActivityAt =
      main === null
        ? laterIso(project.createdAt, project.updatedAt)
        : laterIso(threadActivityAt(main), main.createdAt);
    const status: BotStatus =
      threadStatus !== "idle"
        ? threadStatus
        : !hasHatched(project, main)
          ? "hatching"
          : input.now !== undefined &&
              input.now - (toSortableTimestamp(lastActivityAt) ?? input.now) > BOT_DOZE_AFTER_MS
            ? "dozing"
            : "idle";
    const message = main?.source.latestVisibleMessage ?? null;
    const conversations = threads.filter((thread) => isBotConversationThread(thread, mainThreadId));
    rows.push({
      key,
      environmentId: project.environmentId,
      machineLabel: input.machineLabels.get(project.environmentId) ?? null,
      projectId: project.id,
      name: project.title,
      avatar: project.avatar ?? null,
      mainThreadId,
      lastMessagePreview: message === null ? null : botMessagePreview(message.text),
      lastMessageFromUser: message?.role === "user",
      status,
      unread: conversations.some((thread) => isThreadUnread(thread, input.localLastVisitedAt)),
      lastActivityAt,
      activityThreadCount: threads.length - conversations.length,
      madeBy:
        project.parentBotProjectId == null
          ? null
          : (titlesByProjectKey.get(
              scopedProjectKey({
                environmentId: project.environmentId,
                projectId: project.parentBotProjectId,
              }),
            ) ?? null),
      pinnedAt: project.pinnedAt ?? null,
    });
  }
  return rows.sort((a, b) => compareByActivity(a, b, a.key, b.key));
}

/** Pinned bots, oldest pin first so pins do not reshuffle, then the rest by activity. */
export function splitPinnedBots<Row extends Pick<BotRow, "key" | "pinnedAt">>(
  rows: ReadonlyArray<Row>,
): { readonly pinned: ReadonlyArray<Row>; readonly unpinned: ReadonlyArray<Row> } {
  const pinned = rows
    .filter((row) => row.pinnedAt !== null)
    .sort(
      (a, b) =>
        (toSortableTimestamp(a.pinnedAt!) ?? 0) - (toSortableTimestamp(b.pinnedAt!) ?? 0) ||
        a.key.localeCompare(b.key),
    );
  return { pinned, unpinned: rows.filter((row) => row.pinnedAt === null) };
}

/**
 * The unarchived bots below a bot, children and their children, on its environment. Archiving
 * with `includeChildren` takes these along.
 */
export function liveBotDescendants(
  projects: ReadonlyArray<
    Pick<EnvironmentProject, "environmentId" | "id" | "archivedAt" | "parentBotProjectId">
  >,
  bot: { readonly environmentId: EnvironmentId; readonly projectId: ProjectId },
): ReadonlyArray<ProjectId> {
  const found: ProjectId[] = [];
  const seen = new Set<ProjectId>([bot.projectId]);
  const queue = [bot.projectId];
  while (queue.length > 0) {
    const parent = queue.shift()!;
    for (const project of projects) {
      if (project.environmentId !== bot.environmentId) continue;
      if (project.parentBotProjectId !== parent || seen.has(project.id)) continue;
      seen.add(project.id);
      queue.push(project.id);
      if (project.archivedAt == null) found.push(project.id);
    }
  }
  return found;
}

function botThreadRow(
  thread: EnvironmentThreadShell,
  localLastVisitedAt: Readonly<Record<string, string>> | undefined,
): BotThreadRow {
  return {
    environmentId: thread.environmentId,
    threadId: thread.id,
    title: thread.title,
    status: botStatusOfThread(thread),
    unread: isThreadUnread(thread, localLastVisitedAt),
    lastActivityAt: threadActivityAt(thread),
  };
}

/** A bot's background threads, most recently active first. */
export function deriveBotActivity(input: {
  readonly project: Pick<EnvironmentProject, "environmentId" | "id" | "mainThreadId">;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly localLastVisitedAt?: Readonly<Record<string, string>>;
}): ReadonlyArray<BotThreadRow> {
  const threads = botThreads(input.project, input.threads);
  const mainThreadId = botMainThreadId(input.project, threads);
  return threads
    .filter((thread) => !isBotConversationThread(thread, mainThreadId))
    .map((thread) => botThreadRow(thread, input.localLastVisitedAt))
    .sort((a, b) => compareByActivity(a, b, a.threadId, b.threadId));
}

/**
 * A bot's conversations as tabs: the main one, then the ones the user started, oldest first so
 * tabs stay put as they get busy. Empty until the bot has a thread.
 */
export function deriveBotConversations(input: {
  readonly project: Pick<EnvironmentProject, "environmentId" | "id" | "mainThreadId">;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly localLastVisitedAt?: Readonly<Record<string, string>>;
}): ReadonlyArray<BotConversationTab> {
  const threads = botThreads(input.project, input.threads);
  const mainThreadId = botMainThreadId(input.project, threads);
  return threads
    .filter((thread) => isBotConversationThread(thread, mainThreadId))
    .sort(
      (a, b) =>
        Number(b.id === mainThreadId) - Number(a.id === mainThreadId) ||
        (toSortableTimestamp(a.createdAt) ?? 0) - (toSortableTimestamp(b.createdAt) ?? 0) ||
        a.id.localeCompare(b.id),
    )
    .map((thread) => ({
      ...botThreadRow(thread, input.localLastVisitedAt),
      main: thread.id === mainThreadId,
    }));
}

/** The bot's main thread id, read from the shells this client holds. */
export function resolveBotMainThreadId(
  project: Pick<EnvironmentProject, "environmentId" | "id" | "mainThreadId">,
  threads: ReadonlyArray<EnvironmentThreadShell>,
): ThreadId | null {
  return botMainThreadId(project, botThreads(project, threads));
}

/**
 * The limit a home-folder bot really runs under, which the thread's runtime mode alone
 * overstates. Supervised threads keep asking either way, so their label stays true.
 */
export function botAccessLimitLabel(
  autonomy: BotAutonomy | undefined,
  runtimeMode: RuntimeMode,
): string | null {
  return autonomy === "home-folder" && runtimeMode !== "approval-required" ? "Home folder" : null;
}
