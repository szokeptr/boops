import type { ProjectId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as ProjectService from "../project/ProjectService.ts";

export class BotFamilyError extends Schema.TaggedError<BotFamilyError>()("BotFamilyError", {
  reason: Schema.Literals(["not-found", "unrelated", "declined", "invalid", "unavailable"]),
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

interface FamilyMember {
  readonly id: ProjectId;
  readonly mainThreadId?: ThreadId | null | undefined;
  readonly parentBotProjectId?: ProjectId | null | undefined;
}

/** What `other` is to `self`: its parent, its child, or neither. Only direct links count. */
function botRelation(self: FamilyMember, other: FamilyMember): "parent" | "child" | null {
  if (self.parentBotProjectId === other.id) return "parent";
  if (other.parentBotProjectId === self.id) return "child";
  return null;
}

/** `Bots.create` records a main thread; scratch and plain projects have none. */
const isBot = (member: FamilyMember | undefined): member is FamilyMember =>
  member?.mainThreadId != null;

/** Two bots may message each other only when one created the other; non-bot projects are not limited. */
export const assertBotsMayTalk = Effect.fn("BotFamily.assertMayTalk")(function* (
  fromProjectId: ProjectId,
  toProjectId: ProjectId,
) {
  if (fromProjectId === toProjectId) return;
  const projects = yield* ProjectService.ProjectService;
  const shells = yield* projects
    .listShells({ projectIds: [fromProjectId, toProjectId] })
    .pipe(
      Effect.mapError(
        () => new BotFamilyError({ reason: "unavailable", detail: "Could not read the bots." }),
      ),
    );
  const from = shells.find((shell) => shell.id === fromProjectId);
  const to = shells.find((shell) => shell.id === toProjectId);
  if (!isBot(from) || !isBot(to) || botRelation(from, to) !== null) return;
  return yield* new BotFamilyError({
    reason: "unrelated",
    detail: "A bot can only reach its parent bot and the bots it created.",
  });
});
