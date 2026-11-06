import {
  linkOriginIsFenced,
  OrchestratorMcpFailure,
  type OrchestrationV2LinkOrigin,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { Caller } from "./threadAccess.ts";

/**
 * Below full access, work a link starts here (all of it carries that session in `linkOrigin`)
 * may change only work from the same link: not the user's threads, projects or settings, nor
 * this environment's links. Reads are not fenced. It is a routing rule for T3's tools; agents
 * still run as this environment's user, so a full-access link is not fenced at all.
 */

/** The link a caller acts for: its own session, or the link that started its thread. */
export const callerLinkOrigin = (
  caller: Pick<Caller, "scope" | "caller">,
): OrchestrationV2LinkOrigin | undefined =>
  caller.caller?.linkOrigin ??
  (caller.scope.client?.linked === true
    ? {
        sessionId: caller.scope.client.sessionId,
        label: caller.scope.client.label,
        access: caller.scope.client.access,
      }
    : undefined);

/**
 * The link that fences a caller, if any: one paired below full access, or an invited member's at
 * any access. A member is matched by member, not session (each device has one), and her reads are
 * fenced too, so she never learns about the owner's work.
 */
const fencingLinkOrigin = (caller: Pick<Caller, "scope" | "caller">) => {
  const origin = callerLinkOrigin(caller);
  return origin !== undefined && (origin.memberId !== undefined || linkOriginIsFenced(origin))
    ? origin
    : undefined;
};

const outsideLink = (origin: OrchestrationV2LinkOrigin, message: string) =>
  new OrchestratorMcpFailure({
    code: "capability_denied",
    message:
      origin.memberId === undefined
        ? `This work was started from ${origin.label} through a linked environment, so ${message} A link paired with full access is not limited this way.`
        : `This conversation is with ${origin.label}, whom the owner invited to chat with this bot, so ${message}`,
  });

const isSameOrigin = (
  origin: OrchestrationV2LinkOrigin,
  target: Pick<OrchestrationV2ThreadShell, "linkOrigin">,
) =>
  origin.memberId === undefined
    ? target.linkOrigin?.sessionId === origin.sessionId
    : target.linkOrigin?.memberId === origin.memberId;

/** A thread a fenced caller may change: one its own link, or its own member, started. */
export const assertSameLink = (
  caller: Pick<Caller, "scope" | "caller">,
  target: Pick<OrchestrationV2ThreadShell, "id" | "linkOrigin">,
) => {
  const origin = fencingLinkOrigin(caller);
  return origin === undefined || isSameOrigin(origin, target)
    ? Effect.void
    : Effect.fail(
        outsideLink(
          origin,
          origin.memberId === undefined
            ? `it may change only threads that link started.`
            : `it may change only their conversations.`,
        ),
      );
};

/** A thread a member's work may read: only hers. Other callers read anything. */
export const assertMayRead = (
  caller: Pick<Caller, "scope" | "caller">,
  target: Pick<OrchestrationV2ThreadShell, "id" | "linkOrigin">,
) => {
  const origin = callerLinkOrigin(caller);
  return origin?.memberId === undefined || isSameOrigin(origin, target)
    ? Effect.void
    : Effect.fail(outsideLink(origin, `it may read only their conversations.`));
};

/** Fenced work never changes what the environment already has: projects, settings, scheduled runs. */
export const assertNotLinked = (caller: Pick<Caller, "scope" | "caller">, what: string) => {
  const origin = fencingLinkOrigin(caller);
  return origin === undefined
    ? Effect.void
    : Effect.fail(outsideLink(origin, `it cannot ${what}.`));
};

/** Whether a caller's work is an invited member's, which reaches only the tools her chat needs. */
export const isMemberCaller = (caller: Pick<Caller, "caller">) =>
  caller.caller?.linkOrigin?.memberId !== undefined;
