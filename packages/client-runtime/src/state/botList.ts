import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
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

export type BotStatus = "working" | "needs-you" | "idle";

export interface BotThreadRow {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly title: string;
  readonly status: BotStatus;
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
  readonly avatar: string | null;
  readonly mainThreadId: ThreadId | null;
  readonly lastMessagePreview: string | null;
  readonly lastMessageFromUser: boolean;
  readonly status: BotStatus;
  readonly unread: boolean;
  readonly lastActivityAt: string;
  /** Live threads besides the main one, which the bot's activity view lists. */
  readonly activityThreadCount: number;
}

export interface BotListInput {
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly machineLabels: ReadonlyMap<EnvironmentId, string>;
  /** Client-kept visit watermarks by scoped thread key, for servers without visit tracking. */
  readonly localLastVisitedAt?: Readonly<Record<string, string>>;
}

// Rows render one line; a long reply would only be clipped by CSS.
const PREVIEW_MAX_LENGTH = 200;

/** The bot's avatar. Always null until projects carry one. */
export function botAvatar(_project: EnvironmentProject): string | null {
  return null;
}

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

/** A stable non-negative number per project, so a placeholder keeps its colour. */
export function botAvatarSeed(projectId: ProjectId): number {
  let hash = 0;
  for (let index = 0; index < projectId.length; index += 1) {
    hash = (hash * 31 + projectId.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function isListedThread(thread: EnvironmentThreadShell): boolean {
  return thread.archivedAt === null && thread.deletedAt === null;
}

/**
 * The bot's main conversation: the earliest-created live top-level thread of
 * its project, until projects name their main thread.
 */
export function resolveBotMainThread(
  project: Pick<EnvironmentProject, "environmentId" | "id">,
  threads: ReadonlyArray<EnvironmentThreadShell>,
): EnvironmentThreadShell | null {
  let main: EnvironmentThreadShell | null = null;
  for (const thread of threads) {
    if (thread.environmentId !== project.environmentId || thread.projectId !== project.id) continue;
    if (!isListedThread(thread) || thread.lineage.parentThreadId !== null) continue;
    if (
      main === null ||
      thread.createdAt < main.createdAt ||
      (thread.createdAt === main.createdAt && thread.id < main.id)
    ) {
      main = thread;
    }
  }
  return main;
}

function botStatusOfThread(thread: EnvironmentThreadShell): BotStatus {
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

const STATUS_RANK: Record<BotStatus, number> = { idle: 0, working: 1, "needs-you": 2 };

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

  const rows: BotRow[] = [];
  for (const project of input.projects) {
    if (project.archivedAt != null || project.isScratch) continue;
    const key = scopedProjectKey({ environmentId: project.environmentId, projectId: project.id });
    const threads = threadsByProjectKey.get(key) ?? [];
    const main = resolveBotMainThread(project, threads);
    let status: BotStatus = "idle";
    for (const thread of threads) {
      const threadStatus = botStatusOfThread(thread);
      if (STATUS_RANK[threadStatus] > STATUS_RANK[status]) status = threadStatus;
    }
    const message = main?.source.latestVisibleMessage ?? null;
    rows.push({
      key,
      environmentId: project.environmentId,
      machineLabel: input.machineLabels.get(project.environmentId) ?? null,
      projectId: project.id,
      name: project.title,
      avatar: botAvatar(project),
      mainThreadId: main?.id ?? null,
      lastMessagePreview: message === null ? null : previewText(message.text),
      lastMessageFromUser: message?.role === "user",
      status,
      unread: main !== null && isThreadUnread(main, input.localLastVisitedAt),
      lastActivityAt:
        main === null
          ? laterIso(project.createdAt, project.updatedAt)
          : laterIso(threadActivityAt(main), main.createdAt),
      activityThreadCount: threads.length - (main === null ? 0 : 1),
    });
  }
  return rows.sort((a, b) => compareByActivity(a, b, a.key, b.key));
}

/** A bot's threads other than its main one, most recently active first. */
export function deriveBotActivity(input: {
  readonly project: Pick<EnvironmentProject, "environmentId" | "id">;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly localLastVisitedAt?: Readonly<Record<string, string>>;
}): ReadonlyArray<BotThreadRow> {
  const main = resolveBotMainThread(input.project, input.threads);
  const rows: BotThreadRow[] = [];
  for (const thread of input.threads) {
    if (
      thread.environmentId !== input.project.environmentId ||
      thread.projectId !== input.project.id ||
      !isListedThread(thread) ||
      thread.id === main?.id
    ) {
      continue;
    }
    rows.push({
      environmentId: thread.environmentId,
      threadId: thread.id,
      title: thread.title,
      status: botStatusOfThread(thread),
      unread: isThreadUnread(thread, input.localLastVisitedAt),
      lastActivityAt: threadActivityAt(thread),
    });
  }
  return rows.sort((a, b) => compareByActivity(a, b, a.threadId, b.threadId));
}
