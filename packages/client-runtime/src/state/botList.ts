import {
  botMainThreadId,
  type EnvironmentId,
  type ProjectAvatar,
  type ProjectId,
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

/** What one thread of a bot is doing. */
export type BotThreadStatus = "working" | "needs-you" | "idle";

/**
 * What the bot is doing, as its avatar shows it. Hatching: its conversation has
 * not had a turn yet. Dozing: idle and quiet for a while.
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
  /** Live threads besides the main one, which the bot's activity view lists. */
  readonly activityThreadCount: number;
  /** Name of the bot that created this one, for the "made by" badge. */
  readonly madeBy: string | null;
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

function previewText(text: string): string | null {
  const collapsed = text.replace(/\s+/g, " ").trim();
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
        : main === null || main.latestRun === null
          ? "hatching"
          : input.now !== undefined &&
              input.now - (toSortableTimestamp(lastActivityAt) ?? input.now) > BOT_DOZE_AFTER_MS
            ? "dozing"
            : "idle";
    const message = main?.source.latestVisibleMessage ?? null;
    rows.push({
      key,
      environmentId: project.environmentId,
      machineLabel: input.machineLabels.get(project.environmentId) ?? null,
      projectId: project.id,
      name: project.title,
      avatar: project.avatar ?? null,
      mainThreadId,
      lastMessagePreview: message === null ? null : previewText(message.text),
      lastMessageFromUser: message?.role === "user",
      status,
      unread: main !== null && isThreadUnread(main, input.localLastVisitedAt),
      lastActivityAt,
      activityThreadCount: threads.filter((thread) => thread.id !== mainThreadId).length,
      madeBy:
        project.parentBotProjectId == null
          ? null
          : (titlesByProjectKey.get(
              scopedProjectKey({
                environmentId: project.environmentId,
                projectId: project.parentBotProjectId,
              }),
            ) ?? null),
    });
  }
  return rows.sort((a, b) => compareByActivity(a, b, a.key, b.key));
}

/** A bot's threads other than its main one, most recently active first. */
export function deriveBotActivity(input: {
  readonly project: Pick<EnvironmentProject, "environmentId" | "id" | "mainThreadId">;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly localLastVisitedAt?: Readonly<Record<string, string>>;
}): ReadonlyArray<BotThreadRow> {
  const threads = botThreads(input.project, input.threads);
  const mainThreadId = botMainThreadId(input.project, threads);
  return threads
    .filter((thread) => thread.id !== mainThreadId)
    .map((thread): BotThreadRow => ({
      environmentId: thread.environmentId,
      threadId: thread.id,
      title: thread.title,
      status: botStatusOfThread(thread),
      unread: isThreadUnread(thread, input.localLastVisitedAt),
      lastActivityAt: threadActivityAt(thread),
    }))
    .sort((a, b) => compareByActivity(a, b, a.threadId, b.threadId));
}

/** The bot's main thread id, read from the shells this client holds. */
export function resolveBotMainThreadId(
  project: Pick<EnvironmentProject, "environmentId" | "id" | "mainThreadId">,
  threads: ReadonlyArray<EnvironmentThreadShell>,
): ThreadId | null {
  return botMainThreadId(project, botThreads(project, threads));
}
