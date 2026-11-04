import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

import { ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";

export const BotCreateInput = Schema.Struct({
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  modelSelection: ModelSelection,
  /** Start the main thread's first turn so the bot opens its hatching interview. Defaults on. */
  hatch: Schema.optional(Schema.Boolean),
});
export type BotCreateInput = typeof BotCreateInput.Type;

export const BotCreateResult = Schema.Struct({
  projectId: ProjectId,
  mainThreadId: ThreadId,
});
export type BotCreateResult = typeof BotCreateResult.Type;

type Timestamp = string | DateTime.DateTime;

const epochMillis = (at: Timestamp) =>
  typeof at === "string" ? Date.parse(at) : DateTime.toEpochMillis(at);

/**
 * A bot's conversation: the recorded main thread, else its project's oldest unarchived thread.
 * Accepts server thread shells and client ones, whose timestamps are ISO strings.
 */
export function botMainThreadId(
  project: { readonly id: ProjectId; readonly mainThreadId?: ThreadId | null | undefined },
  threads: ReadonlyArray<{
    readonly id: ThreadId;
    readonly projectId: ProjectId;
    readonly createdAt: Timestamp;
    readonly archivedAt: Timestamp | null;
  }>,
): ThreadId | null {
  if (project.mainThreadId) return project.mainThreadId;
  let earliest: { readonly id: ThreadId; readonly createdAt: number } | undefined;
  for (const thread of threads) {
    if (thread.projectId !== project.id || thread.archivedAt !== null) continue;
    const createdAt = epochMillis(thread.createdAt);
    if (
      earliest === undefined ||
      createdAt < earliest.createdAt ||
      (createdAt === earliest.createdAt && thread.id < earliest.id)
    ) {
      earliest = { id: thread.id, createdAt };
    }
  }
  return earliest?.id ?? null;
}
