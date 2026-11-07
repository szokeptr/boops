import type { BotCallMessageOrigin } from "@t3tools/contracts";

export interface BotCallFoldMessage {
  readonly id: string;
  readonly role: string;
  readonly runId?: string | null | undefined;
  readonly context?: { readonly call?: BotCallMessageOrigin | undefined } | undefined;
}

/** What the bot did on a call: each request the voice passed on, with the bot's replies to it. */
export interface BotCallWorkEntry<M> {
  /** Null for the bot's replies after the call, to its transcript. */
  readonly request: M | null;
  readonly replies: ReadonlyArray<M>;
}

/**
 * A call's requests and the bot's replies to them fold into the call's row instead of filling the
 * conversation while the user talks. Messages arrive oldest first.
 */
export function foldBotCallMessages<M extends BotCallFoldMessage>(
  messages: ReadonlyArray<M>,
): {
  /** Messages the conversation leaves out; a call's transcript row stays. */
  readonly hidden: ReadonlySet<string>;
  /** Keyed by the transcript message's id. */
  readonly workByRecapId: ReadonlyMap<string, ReadonlyArray<BotCallWorkEntry<M>>>;
} {
  const hidden = new Set<string>();
  const entriesByCall = new Map<string, Array<{ request: M | null; replies: M[] }>>();
  const recapIdByCall = new Map<string, string>();
  const entryByRun = new Map<string, { request: M | null; replies: M[] }>();

  for (const message of messages) {
    const call = message.role === "user" ? message.context?.call : undefined;
    if (call !== undefined) {
      const entry = { request: call.kind === "request" ? message : null, replies: [] };
      const entries = entriesByCall.get(call.callId) ?? [];
      entries.push(entry);
      entriesByCall.set(call.callId, entries);
      if (call.kind === "request") hidden.add(message.id);
      else recapIdByCall.set(call.callId, message.id);
      if (message.runId) entryByRun.set(message.runId, entry);
      continue;
    }
    const entry =
      message.role === "assistant" && message.runId ? entryByRun.get(message.runId) : undefined;
    if (entry !== undefined) {
      entry.replies.push(message);
      hidden.add(message.id);
    }
  }

  const workByRecapId = new Map<string, ReadonlyArray<BotCallWorkEntry<M>>>();
  for (const [callId, recapId] of recapIdByCall) {
    const work = (entriesByCall.get(callId) ?? []).filter(
      (entry) => entry.request !== null || entry.replies.length > 0,
    );
    if (work.length > 0) workByRecapId.set(recapId, work);
  }
  return { hidden, workByRecapId };
}

// The server adds the lines said before a request for the bot; people see the request itself.
const CONTEXT_MARKER = "\n\nJust before, on the call:";

/** A call request's own words, without the call context the bot gets with it. */
export function botCallRequestWords(text: string): string {
  const marker = text.indexOf(CONTEXT_MARKER);
  return (marker < 0 ? text : text.slice(0, marker)).trim();
}
