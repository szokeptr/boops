/**
 * Phones' X25519 keys, so bot reply previews can be sealed to them; see `notificationKeys.ts` in
 * contracts. Each key belongs to an audience: the owner, or the member whose session sent it.
 */
import {
  type EnvironmentMemberId,
  memberIdFromSessionSubject,
  type NotificationDeviceId,
  type NotificationDevicePublicKey,
  NotificationKeysError,
  type NotificationsRegisterDeviceKeyInput,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

/** Matches the relay's cap on previews per published state. */
export const MAX_NOTIFICATION_DEVICES_PER_AUDIENCE = 20;

const OWNER_AUDIENCE = "owner";

const audienceOf = (memberId: EnvironmentMemberId | undefined): string =>
  memberId ?? OWNER_AUDIENCE;

const audienceOfSubject = (subject: string) => audienceOf(memberIdFromSessionSubject(subject));

export interface NotificationDeviceKey {
  readonly deviceId: NotificationDeviceId;
  readonly publicKey: NotificationDevicePublicKey;
}

const persistence = (cause: unknown) => new NotificationKeysError({ reason: "persistence", cause });

export class NotificationDeviceKeys extends Context.Service<
  NotificationDeviceKeys,
  {
    /** Records the calling session's phone; a device id seen under another audience moves here. */
    readonly register: (
      sessionSubject: string,
      input: NotificationsRegisterDeviceKeyInput,
    ) => Effect.Effect<void, NotificationKeysError>;
    /** Forgets the phone, only when the calling session's audience owns it. */
    readonly remove: (
      sessionSubject: string,
      deviceId: NotificationDeviceId,
    ) => Effect.Effect<void, NotificationKeysError>;
    /** The member's phones, or the owner's when `memberId` is undefined. */
    readonly listForAudience: (
      memberId: EnvironmentMemberId | undefined,
    ) => Effect.Effect<ReadonlyArray<NotificationDeviceKey>, NotificationKeysError>;
    /** A removed member's phones stop receiving previews. */
    readonly removeMember: (
      memberId: EnvironmentMemberId,
    ) => Effect.Effect<void, NotificationKeysError>;
  }
>()("boops/notifications/NotificationDeviceKeys") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const register: NotificationDeviceKeys["Service"]["register"] = Effect.fn(
    "NotificationDeviceKeys.register",
  )(function* (sessionSubject, input) {
    const audience = audienceOfSubject(sessionSubject);
    const updatedAt = DateTime.formatIso(yield* DateTime.now);
    yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const others = yield* sql<{ readonly count: number }>`
            SELECT COUNT(*) AS count FROM notification_device_keys
            WHERE audience = ${audience} AND device_id <> ${input.deviceId}
          `;
          if ((others[0]?.count ?? 0) >= MAX_NOTIFICATION_DEVICES_PER_AUDIENCE) {
            return yield* new NotificationKeysError({ reason: "limit-reached" });
          }
          yield* sql`
            INSERT INTO notification_device_keys (device_id, audience, public_key, updated_at)
            VALUES (${input.deviceId}, ${audience}, ${input.publicKey}, ${updatedAt})
            ON CONFLICT (device_id) DO UPDATE SET
              audience = excluded.audience,
              public_key = excluded.public_key,
              updated_at = excluded.updated_at
          `;
        }),
      )
      .pipe(Effect.catchTags({ SqlError: (cause) => Effect.fail(persistence(cause)) }));
  });

  const remove: NotificationDeviceKeys["Service"]["remove"] = Effect.fn(
    "NotificationDeviceKeys.remove",
  )(function* (sessionSubject, deviceId) {
    const audience = audienceOfSubject(sessionSubject);
    yield* sql`
      DELETE FROM notification_device_keys
      WHERE device_id = ${deviceId} AND audience = ${audience}
    `.pipe(Effect.mapError(persistence));
  });

  const listForAudience: NotificationDeviceKeys["Service"]["listForAudience"] = Effect.fn(
    "NotificationDeviceKeys.listForAudience",
  )(function* (memberId) {
    return yield* sql<NotificationDeviceKey>`
      SELECT device_id AS "deviceId", public_key AS "publicKey"
      FROM notification_device_keys
      WHERE audience = ${audienceOf(memberId)}
      ORDER BY updated_at DESC, device_id
      LIMIT ${MAX_NOTIFICATION_DEVICES_PER_AUDIENCE}
    `.pipe(NodeSqliteClient.readOnly, Effect.mapError(persistence));
  });

  const removeMember: NotificationDeviceKeys["Service"]["removeMember"] = Effect.fn(
    "NotificationDeviceKeys.removeMember",
  )(function* (memberId) {
    yield* sql`DELETE FROM notification_device_keys WHERE audience = ${memberId}`.pipe(
      Effect.mapError(persistence),
    );
  });

  return NotificationDeviceKeys.of({ register, remove, listForAudience, removeMember });
});

export const layer = Layer.effect(NotificationDeviceKeys, make);
