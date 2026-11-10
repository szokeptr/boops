export type ThreadNotificationKind = "input" | "completion";

export interface ThreadNotificationObservation {
  /** Run and status key while the thread needs attention, otherwise null. */
  readonly attention: string | null;
  /** The thread is idle and its latest run completed. */
  readonly settled: boolean;
  /** When the latest run completed, if it did. */
  readonly completedAt: number | null;
}

/** What one room list snapshot says about a group chat. */
export interface RoomSighting {
  readonly lastMessageId: string | null;
  readonly lastAuthor: "person" | "bot" | "system" | null;
  /** The last message hands off to other bots, which answer next. */
  readonly lastMentionsBots: boolean;
  readonly working: boolean;
  /** Someone else wrote since the viewer last read; the server leaves out their own and its notes. */
  readonly unread: boolean;
  readonly needsYou: boolean;
  readonly muted: boolean;
  readonly listed: boolean;
}

export interface RoomNotificationObservation extends RoomSighting {
  /** Someone else wrote and the viewer has not been told yet. */
  readonly owed: boolean;
}

/**
 * What a group chat's change should sound like: a bot newly waiting on the viewer asks for input,
 * even when muted, since it is stuck until they answer; someone else's new message notifies
 * unless muted, once bots stop answering each other, so a chain of replies notifies once. A room
 * first seen, left or archived is quiet.
 */
export function observeRoomNotification(
  prior: RoomNotificationObservation | undefined,
  next: RoomSighting,
): {
  readonly observation: RoomNotificationObservation;
  readonly kind: ThreadNotificationKind | null;
} {
  if (prior === undefined || !next.listed) {
    return { observation: { ...next, owed: false }, kind: null };
  }
  const arrived =
    next.unread &&
    next.lastAuthor !== "system" &&
    next.lastMessageId !== null &&
    next.lastMessageId !== prior.lastMessageId;
  // Reading the room or writing in it settles what was owed; a room note after the bots keeps it.
  const owed =
    !next.muted && (arrived || (prior.owed && (next.unread || next.lastAuthor === "system")));
  if (next.needsYou && !prior.needsYou) {
    return { observation: { ...next, owed }, kind: "input" };
  }
  const settling = next.lastAuthor === "bot" && (next.working || next.lastMentionsBots);
  if (owed && !settling) return { observation: { ...next, owed: false }, kind: "completion" };
  return { observation: { ...next, owed }, kind: null };
}

export function createThreadNotificationGate<Key>(
  notify: (key: Key, kind: ThreadNotificationKind) => void,
) {
  // The newest completion already notified, or deliberately skipped.
  const handled = new Map<Key, number>();
  const skip = (key: Key, at: number | null) => {
    if (at !== null && at > (handled.get(key) ?? -Infinity)) handled.set(key, at);
  };
  return {
    observe(
      key: Key,
      prior: ThreadNotificationObservation | undefined,
      next: ThreadNotificationObservation,
      options: { readonly archived: boolean; readonly quiet: boolean },
    ): void {
      // The first sighting, archived threads, and stopped or silent runs never notify completion.
      if (!prior || options.archived || options.quiet) skip(key, next.completedAt);
      if (!prior || options.archived) return;
      if (next.attention && next.attention !== prior.attention) {
        notify(key, "input");
        return;
      }
      const at = next.completedAt;
      if (!next.settled || at === null || at <= (handled.get(key) ?? -Infinity)) return;
      handled.set(key, at);
      notify(key, "completion");
    },
    /** Forgets threads that left the snapshot. */
    retain(keys: ReadonlySet<Key>): void {
      for (const key of handled.keys()) if (!keys.has(key)) handled.delete(key);
    },
    clear(): void {
      handled.clear();
    },
  };
}
