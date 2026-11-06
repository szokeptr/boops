import type {
  RelayClientEnvironmentRecord,
  RelayEnvironmentInvite,
  RelayMemberInviteRequest,
} from "@t3tools/contracts/relay";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { and, asc, eq, exists, isNull, sql } from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/pg-core";

import * as ClerkUsers from "../auth/ClerkUsers.ts";
import * as RelayDb from "../db.ts";
import { relayEnvironmentInvites, relayEnvironmentLinks } from "../persistence/schema.ts";

export class EnvironmentMemberPersistenceError extends Schema.TaggedError<EnvironmentMemberPersistenceError>()(
  "EnvironmentMemberPersistenceError",
  {
    operation: Schema.Literals([
      "put-invite",
      "remove-member",
      "remove-for-owner",
      "list-invites",
      "accept-invite",
      "decline-invite",
    ]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Environment member query '${this.operation}' failed`;
  }
}

/** No pending invite for this user's verified email, and no member link it already created. */
export class EnvironmentInviteNotFound extends Schema.TaggedError<EnvironmentInviteNotFound>()(
  "EnvironmentInviteNotFound",
  { inviteId: Schema.String },
) {
  override get message(): string {
    return `No invite '${this.inviteId}' for this account`;
  }
}

export class EnvironmentMembers extends Context.Service<
  EnvironmentMembers,
  {
    readonly putInvite: (input: {
      readonly environmentId: string;
      readonly environmentPublicKey: string;
      readonly memberId: string;
      readonly request: RelayMemberInviteRequest;
    }) => Effect.Effect<void, EnvironmentMemberPersistenceError>;
    /** Withdraws the invite and deletes the member link it became. */
    readonly removeMember: (input: {
      readonly environmentId: string;
      readonly environmentPublicKey: string;
      readonly memberId: string;
    }) => Effect.Effect<void, EnvironmentMemberPersistenceError>;
    /** The owner's link is gone, so everything shared through it goes too. */
    readonly removeForOwner: (input: {
      readonly environmentId: string;
      readonly environmentPublicKey: string;
      readonly ownerUserId: string;
    }) => Effect.Effect<void, EnvironmentMemberPersistenceError>;
    /** Invites to the user's verified email whose owner is still linked; empty when Clerk is down. */
    readonly listInvites: (input: {
      readonly userId: string;
    }) => Effect.Effect<ReadonlyArray<RelayEnvironmentInvite>, EnvironmentMemberPersistenceError>;
    /** Idempotent: re-accepting a consumed invite returns the link it created. */
    readonly accept: (input: {
      readonly userId: string;
      readonly inviteId: string;
    }) => Effect.Effect<
      RelayClientEnvironmentRecord,
      | EnvironmentInviteNotFound
      | EnvironmentMemberPersistenceError
      | ClerkUsers.ClerkEmailLookupFailed
    >;
    readonly decline: (input: {
      readonly userId: string;
      readonly inviteId: string;
    }) => Effect.Effect<
      boolean,
      EnvironmentMemberPersistenceError | ClerkUsers.ClerkEmailLookupFailed
    >;
  }
>()("t3code-relay/environments/EnvironmentMembers") {}

interface AcceptedLinkRow extends Record<string, unknown> {
  readonly environment_id: string;
  readonly environment_label: string;
  readonly endpoint_http_base_url: string;
  readonly endpoint_ws_base_url: string;
  readonly endpoint_provider_kind: string;
  readonly created_at: string;
}

/**
 * One statement, so the member link and the consumed invite commit together. The member copies
 * the owner's active link; an existing active owner link for the same user is never overwritten.
 */
export function acceptInviteStatement(input: {
  readonly userId: string;
  readonly inviteId: string;
  readonly email: string;
  readonly now: string;
}) {
  return sql`
    WITH invite AS (
      SELECT i.environment_id, i.member_id, owner.user_id AS owner_user_id,
        owner.environment_label, owner.environment_public_key, owner.endpoint_http_base_url,
        owner.endpoint_ws_base_url, owner.endpoint_provider_kind
      FROM relay_environment_invites AS i
      JOIN relay_environment_links AS owner
        ON owner.environment_id = i.environment_id
        AND owner.environment_public_key = i.environment_public_key
        AND owner.role = 'owner'
        AND owner.revoked_at IS NULL
      WHERE i.member_id = ${input.inviteId}
        AND i.email = ${input.email}
        AND owner.user_id <> ${input.userId}
      ORDER BY owner.updated_at DESC
      LIMIT 1
    ), linked AS (
      INSERT INTO relay_environment_links AS link (
        user_id, environment_id, environment_label, environment_public_key, endpoint_http_base_url,
        endpoint_ws_base_url, endpoint_provider_kind, managed_tunnels_enabled, role, member_id,
        shared_by_user_id, created_at, updated_at
      )
      SELECT ${input.userId}, environment_id, environment_label, environment_public_key,
        endpoint_http_base_url, endpoint_ws_base_url, endpoint_provider_kind, false, 'member',
        member_id, owner_user_id, ${input.now}, ${input.now}
      FROM invite
      ON CONFLICT (user_id, environment_id) DO UPDATE SET
        environment_label = EXCLUDED.environment_label,
        environment_public_key = EXCLUDED.environment_public_key,
        endpoint_http_base_url = EXCLUDED.endpoint_http_base_url,
        endpoint_ws_base_url = EXCLUDED.endpoint_ws_base_url,
        endpoint_provider_kind = EXCLUDED.endpoint_provider_kind,
        managed_tunnels_enabled = false,
        hold_webhooks_while_offline = false,
        created_by_device_id = NULL,
        role = 'member',
        member_id = EXCLUDED.member_id,
        shared_by_user_id = EXCLUDED.shared_by_user_id,
        revoked_at = NULL,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at
      WHERE link.role = 'member' OR link.revoked_at IS NOT NULL
      RETURNING link.environment_id, link.member_id, link.environment_label,
        link.endpoint_http_base_url, link.endpoint_ws_base_url, link.endpoint_provider_kind,
        link.created_at
    ), consumed AS (
      DELETE FROM relay_environment_invites AS i
      USING linked
      WHERE i.environment_id = linked.environment_id AND i.member_id = linked.member_id
    )
    SELECT environment_id, environment_label, endpoint_http_base_url, endpoint_ws_base_url,
      endpoint_provider_kind, created_at
    FROM linked
  `;
}

function memberRecord(row: {
  readonly environmentId: string;
  readonly environmentLabel: string;
  readonly endpointHttpBaseUrl: string;
  readonly endpointWsBaseUrl: string;
  readonly endpointProviderKind: string;
  readonly createdAt: string;
}): RelayClientEnvironmentRecord {
  return {
    environmentId: row.environmentId as RelayClientEnvironmentRecord["environmentId"],
    label: row.environmentLabel.trim().length > 0 ? row.environmentLabel : row.environmentId,
    endpoint: {
      httpBaseUrl: row.endpointHttpBaseUrl,
      wsBaseUrl: row.endpointWsBaseUrl,
      providerKind:
        row.endpointProviderKind as RelayClientEnvironmentRecord["endpoint"]["providerKind"],
    },
    linkedAt: row.createdAt,
    role: "member",
  };
}

const make = Effect.gen(function* () {
  const db = yield* RelayDb.RelayDb;
  const clerk = yield* ClerkUsers.ClerkUsers;
  const persistenceError =
    (operation: EnvironmentMemberPersistenceError["operation"]) => (cause: unknown) =>
      new EnvironmentMemberPersistenceError({ operation, cause });

  return EnvironmentMembers.of({
    putInvite: Effect.fn("relay.environment_members.put_invite")(function* (input) {
      yield* Effect.annotateCurrentSpan({ "relay.environment_id": input.environmentId });
      const now = DateTime.formatIso(yield* DateTime.now);
      const values = {
        environmentPublicKey: input.environmentPublicKey,
        email: ClerkUsers.normalizeEmail(input.request.email),
        memberLabel: input.request.memberLabel,
        environmentLabel: input.request.environmentLabel,
        updatedAt: now,
      };
      yield* db
        .insert(relayEnvironmentInvites)
        .values({
          environmentId: input.environmentId,
          memberId: input.memberId,
          createdAt: now,
          ...values,
        })
        .onConflictDoUpdate({
          target: [relayEnvironmentInvites.environmentId, relayEnvironmentInvites.memberId],
          set: values,
        })
        .pipe(Effect.mapError(persistenceError("put-invite")));
    }),

    removeMember: Effect.fn("relay.environment_members.remove_member")(function* (input) {
      yield* Effect.annotateCurrentSpan({ "relay.environment_id": input.environmentId });
      yield* Effect.all(
        [
          db
            .delete(relayEnvironmentInvites)
            .where(
              and(
                eq(relayEnvironmentInvites.environmentId, input.environmentId),
                eq(relayEnvironmentInvites.environmentPublicKey, input.environmentPublicKey),
                eq(relayEnvironmentInvites.memberId, input.memberId),
              ),
            ),
          db
            .delete(relayEnvironmentLinks)
            .where(
              and(
                eq(relayEnvironmentLinks.environmentId, input.environmentId),
                eq(relayEnvironmentLinks.environmentPublicKey, input.environmentPublicKey),
                eq(relayEnvironmentLinks.role, "member"),
                eq(relayEnvironmentLinks.memberId, input.memberId),
              ),
            ),
        ],
        { concurrency: 2, discard: true },
      ).pipe(Effect.mapError(persistenceError("remove-member")));
    }),

    removeForOwner: Effect.fn("relay.environment_members.remove_for_owner")(function* (input) {
      yield* Effect.annotateCurrentSpan({ "relay.environment_id": input.environmentId });
      yield* db
        .delete(relayEnvironmentLinks)
        .where(
          and(
            eq(relayEnvironmentLinks.environmentId, input.environmentId),
            eq(relayEnvironmentLinks.role, "member"),
            eq(relayEnvironmentLinks.sharedByUserId, input.ownerUserId),
          ),
        )
        .pipe(Effect.mapError(persistenceError("remove-for-owner")));
      yield* db
        .delete(relayEnvironmentInvites)
        .where(
          and(
            eq(relayEnvironmentInvites.environmentId, input.environmentId),
            eq(relayEnvironmentInvites.environmentPublicKey, input.environmentPublicKey),
          ),
        )
        .pipe(Effect.mapError(persistenceError("remove-for-owner")));
    }),

    listInvites: Effect.fn("relay.environment_members.list_invites")(function* (input) {
      // Almost nobody has a pending invite; skip the Clerk round trip until someone does.
      const anyPending = yield* db
        .select({ memberId: relayEnvironmentInvites.memberId })
        .from(relayEnvironmentInvites)
        .limit(1)
        .pipe(Effect.mapError(persistenceError("list-invites")));
      if (anyPending.length === 0) return [];
      const email = yield* clerk.verifiedPrimaryEmail(input.userId).pipe(
        Effect.catch((error) =>
          Effect.logWarning("Could not read the Clerk email for invites", {
            errorTag: error._tag,
          }).pipe(Effect.as(null)),
        ),
      );
      if (email === null) return [];
      const rows = yield* db
        .select({
          memberId: relayEnvironmentInvites.memberId,
          environmentId: relayEnvironmentInvites.environmentId,
          environmentLabel: relayEnvironmentInvites.environmentLabel,
          memberLabel: relayEnvironmentInvites.memberLabel,
          createdAt: relayEnvironmentInvites.createdAt,
        })
        .from(relayEnvironmentInvites)
        .where(
          and(
            eq(relayEnvironmentInvites.email, email),
            exists(
              new QueryBuilder()
                .select({ userId: relayEnvironmentLinks.userId })
                .from(relayEnvironmentLinks)
                .where(
                  and(
                    eq(relayEnvironmentLinks.environmentId, relayEnvironmentInvites.environmentId),
                    eq(
                      relayEnvironmentLinks.environmentPublicKey,
                      relayEnvironmentInvites.environmentPublicKey,
                    ),
                    eq(relayEnvironmentLinks.role, "owner"),
                    isNull(relayEnvironmentLinks.revokedAt),
                  ),
                ),
            ),
          ),
        )
        .orderBy(asc(relayEnvironmentInvites.createdAt))
        .pipe(Effect.mapError(persistenceError("list-invites")));
      return rows.map((row) => ({
        inviteId: row.memberId,
        environmentId: row.environmentId as RelayEnvironmentInvite["environmentId"],
        environmentLabel: row.environmentLabel,
        memberLabel: row.memberLabel,
        createdAt: row.createdAt,
      }));
    }),

    accept: Effect.fn("relay.environment_members.accept")(function* (input) {
      const email = yield* clerk.verifiedPrimaryEmail(input.userId);
      if (email === null) {
        return yield* new EnvironmentInviteNotFound({ inviteId: input.inviteId });
      }
      const now = DateTime.formatIso(yield* DateTime.now);
      const [accepted] = yield* db
        .execute<AcceptedLinkRow>(
          acceptInviteStatement({ userId: input.userId, inviteId: input.inviteId, email, now }),
          "objects",
        )
        .pipe(Effect.mapError(persistenceError("accept-invite")));
      if (accepted) {
        yield* Effect.annotateCurrentSpan({ "relay.environment_id": accepted.environment_id });
        return memberRecord({
          environmentId: accepted.environment_id,
          environmentLabel: accepted.environment_label,
          endpointHttpBaseUrl: accepted.endpoint_http_base_url,
          endpointWsBaseUrl: accepted.endpoint_ws_base_url,
          endpointProviderKind: accepted.endpoint_provider_kind,
          createdAt: accepted.created_at,
        });
      }
      const [existing] = yield* db
        .select({
          environmentId: relayEnvironmentLinks.environmentId,
          environmentLabel: relayEnvironmentLinks.environmentLabel,
          endpointHttpBaseUrl: relayEnvironmentLinks.endpointHttpBaseUrl,
          endpointWsBaseUrl: relayEnvironmentLinks.endpointWsBaseUrl,
          endpointProviderKind: relayEnvironmentLinks.endpointProviderKind,
          createdAt: relayEnvironmentLinks.createdAt,
        })
        .from(relayEnvironmentLinks)
        .where(
          and(
            eq(relayEnvironmentLinks.userId, input.userId),
            eq(relayEnvironmentLinks.role, "member"),
            eq(relayEnvironmentLinks.memberId, input.inviteId),
            isNull(relayEnvironmentLinks.revokedAt),
          ),
        )
        .limit(1)
        .pipe(Effect.mapError(persistenceError("accept-invite")));
      if (!existing) {
        return yield* new EnvironmentInviteNotFound({ inviteId: input.inviteId });
      }
      return memberRecord(existing);
    }),

    decline: Effect.fn("relay.environment_members.decline")(function* (input) {
      const email = yield* clerk.verifiedPrimaryEmail(input.userId);
      if (email === null) return false;
      const rows = yield* db
        .delete(relayEnvironmentInvites)
        .where(
          and(
            eq(relayEnvironmentInvites.memberId, input.inviteId),
            eq(relayEnvironmentInvites.email, email),
          ),
        )
        .returning({ memberId: relayEnvironmentInvites.memberId })
        .pipe(Effect.mapError(persistenceError("decline-invite")));
      return rows.length > 0;
    }),
  });
});

export const layer = Layer.effect(EnvironmentMembers, make);
