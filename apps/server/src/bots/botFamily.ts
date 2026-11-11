import type {
  BotRelation,
  OrchestrationProjectShell,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
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
  readonly talksWithAnyBot?: boolean | undefined;
}

/** What `other` is to `self`: its parent, its child, its sibling, or neither. Only direct links count. */
function botRelation(
  self: FamilyMember,
  other: FamilyMember,
): "parent" | "child" | "sibling" | null {
  if (self.parentBotProjectId === other.id) return "parent";
  if (other.parentBotProjectId === self.id) return "child";
  if (self.parentBotProjectId != null && self.parentBotProjectId === other.parentBotProjectId) {
    return "sibling";
  }
  return null;
}

/** `Bots.create` records a main thread; scratch and plain projects have none. */
export const isBot = (member: FamilyMember | undefined): member is FamilyMember =>
  member?.mainThreadId != null;

/**
 * Two bots may message each other when one created the other, they share a parent, or either
 * talks with any bot. Both directions, so the one reached can answer. Non-bot projects are not limited.
 */
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
  if (!isBot(from) || !isBot(to)) return;
  if (
    botRelation(from, to) !== null ||
    from.talksWithAnyBot === true ||
    to.talksWithAnyBot === true
  ) {
    return;
  }
  return yield* new BotFamilyError({
    reason: "unrelated",
    detail:
      "A bot can only reach its parent, the bots it created, and its siblings, unless one of the two talks with any bot.",
  });
});

const unavailable = () =>
  new BotFamilyError({ reason: "unavailable", detail: "Could not read the bots." });

/** The bots `projectId` may message, each with what it is to `projectId`. Empty for a non-bot. */
export const reachableBots = Effect.fn("BotFamily.reachableBots")(function* (projectId: ProjectId) {
  const projects = yield* ProjectService.ProjectService;
  const shells = yield* projects.listShells().pipe(Effect.mapError(unavailable));
  const self = shells.find((shell) => shell.id === projectId);
  if (!isBot(self)) return [];
  return shells.flatMap(
    (other): Array<{ readonly bot: OrchestrationProjectShell; readonly relation: BotRelation }> => {
      if (other.id === self.id || !isBot(other)) return [];
      const relation = botRelation(self, other);
      if (relation === null && self.talksWithAnyBot !== true && other.talksWithAnyBot !== true) {
        return [];
      }
      return [{ bot: other, relation: relation ?? "other" }];
    },
  );
});

/**
 * A bot's threads take only its user's and its own writes. Another bot reaches it with
 * message_bot, whose messages carry who sent them; a raw thread write would read as the user's.
 */
export const assertNotAnotherBotsThread = Effect.fn("BotFamily.assertNotAnotherBotsThread")(
  function* (fromProjectId: ProjectId, toProjectId: ProjectId) {
    if (fromProjectId === toProjectId) return;
    const projects = yield* ProjectService.ProjectService;
    const shells = yield* projects
      .listShells({ projectIds: [fromProjectId, toProjectId] })
      .pipe(Effect.mapError(unavailable));
    const from = shells.find((shell) => shell.id === fromProjectId);
    const to = shells.find((shell) => shell.id === toProjectId);
    if (!isBot(from) || !isBot(to)) return;
    return yield* new BotFamilyError({
      reason: "unrelated",
      detail: `That thread is ${to.title}'s. Message ${to.title} with message_bot instead.`,
    });
  },
);
