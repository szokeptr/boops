import {
  EnvironmentMemberId,
  IsoDateTime,
  MemberAccess,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";

import {
  type EnvironmentMemberRepositoryError,
  PersistenceDecodeError,
  PersistenceSqlError,
} from "./Errors.ts";

export const EnvironmentMemberRecord = Schema.Struct({
  id: EnvironmentMemberId,
  label: TrimmedNonEmptyString,
  /** Stored lowercased, so one address has one row. */
  email: TrimmedNonEmptyString,
  access: MemberAccess,
  canCreateRooms: Schema.BooleanFromBit,
  /** The Boops Connect user bound on their first connection; null while invited. */
  cloudUserId: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  lastConnectedAt: Schema.NullOr(IsoDateTime),
});
export type EnvironmentMemberRecord = typeof EnvironmentMemberRecord.Type;

const MemberIdRequest = Schema.Struct({ id: EnvironmentMemberId });
const EmailRequest = Schema.Struct({ email: Schema.String });
const UpdateRequest = Schema.Struct({
  id: EnvironmentMemberId,
  label: Schema.NullOr(TrimmedNonEmptyString),
  access: Schema.NullOr(MemberAccess),
  canCreateRooms: Schema.NullOr(Schema.Boolean),
});
const BindRequest = Schema.Struct({
  id: EnvironmentMemberId,
  cloudUserId: Schema.String,
  connectedAt: IsoDateTime,
});

export class EnvironmentMemberRepository extends Context.Service<
  EnvironmentMemberRepository,
  {
    readonly list: Effect.Effect<
      ReadonlyArray<EnvironmentMemberRecord>,
      EnvironmentMemberRepositoryError
    >;
    readonly getById: (
      id: EnvironmentMemberId,
    ) => Effect.Effect<Option.Option<EnvironmentMemberRecord>, EnvironmentMemberRepositoryError>;
    readonly getByEmail: (
      email: string,
    ) => Effect.Effect<Option.Option<EnvironmentMemberRecord>, EnvironmentMemberRepositoryError>;
    readonly insert: (
      record: EnvironmentMemberRecord,
    ) => Effect.Effect<void, EnvironmentMemberRepositoryError>;
    /** Null leaves a field as it is. */
    readonly update: (
      input: typeof UpdateRequest.Type,
    ) => Effect.Effect<Option.Option<EnvironmentMemberRecord>, EnvironmentMemberRepositoryError>;
    /**
     * Binds `cloudUserId` if the member has none yet and records the connection. None when the
     * member is gone or already bound to someone else.
     */
    readonly bindCloudUser: (
      input: typeof BindRequest.Type,
    ) => Effect.Effect<Option.Option<EnvironmentMemberRecord>, EnvironmentMemberRepositoryError>;
    readonly delete: (
      id: EnvironmentMemberId,
    ) => Effect.Effect<boolean, EnvironmentMemberRepositoryError>;
  }
>()("boops/persistence/EnvironmentMembers/EnvironmentMemberRepository") {}

const toError =
  (operation: string) =>
  (cause: unknown): EnvironmentMemberRepositoryError =>
    Schema.isSchemaError(cause)
      ? PersistenceDecodeError.fromSchemaError(`EnvironmentMemberRepository.${operation}`, cause)
      : new PersistenceSqlError({ operation: `EnvironmentMemberRepository.${operation}`, cause });

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = sql`
    member_id AS "id",
    label AS "label",
    email AS "email",
    access AS "access",
    can_create_rooms AS "canCreateRooms",
    cloud_user_id AS "cloudUserId",
    created_at AS "createdAt",
    last_connected_at AS "lastConnectedAt"
  `;

  const listRows = sql`
    SELECT ${columns} FROM environment_members ORDER BY created_at, member_id
  `.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(EnvironmentMemberRecord))));
  const getRowById = SqlSchema.findOneOption({
    Request: MemberIdRequest,
    Result: EnvironmentMemberRecord,
    execute: ({ id }) => sql`SELECT ${columns} FROM environment_members WHERE member_id = ${id}`,
  });
  const getRowByEmail = SqlSchema.findOneOption({
    Request: EmailRequest,
    Result: EnvironmentMemberRecord,
    execute: ({ email }) => sql`SELECT ${columns} FROM environment_members WHERE email = ${email}`,
  });
  const insertRow = SqlSchema.void({
    Request: EnvironmentMemberRecord,
    execute: (row) => sql`
      INSERT INTO environment_members (
        member_id, label, email, access, can_create_rooms, cloud_user_id, created_at,
        last_connected_at
      ) VALUES (
        ${row.id}, ${row.label}, ${row.email}, ${row.access}, ${row.canCreateRooms}, ${row.cloudUserId},
        ${row.createdAt}, ${row.lastConnectedAt}
      )
    `,
  });
  const updateRow = SqlSchema.findOneOption({
    Request: UpdateRequest,
    Result: EnvironmentMemberRecord,
    execute: ({ id, label, access, canCreateRooms }) => sql`
      UPDATE environment_members
      SET label = COALESCE(${label}, label),
        access = COALESCE(${access}, access),
        can_create_rooms = COALESCE(${canCreateRooms === null ? null : canCreateRooms ? 1 : 0}, can_create_rooms)
      WHERE member_id = ${id}
      RETURNING ${columns}
    `,
  });
  const bindRow = SqlSchema.findOneOption({
    Request: BindRequest,
    Result: EnvironmentMemberRecord,
    execute: ({ id, cloudUserId, connectedAt }) => sql`
      UPDATE environment_members
      SET cloud_user_id = ${cloudUserId}, last_connected_at = ${connectedAt}
      WHERE member_id = ${id} AND (cloud_user_id IS NULL OR cloud_user_id = ${cloudUserId})
      RETURNING ${columns}
    `,
  });
  const deleteRows = SqlSchema.findAll({
    Request: MemberIdRequest,
    Result: MemberIdRequest,
    execute: ({ id }) =>
      sql`DELETE FROM environment_members WHERE member_id = ${id} RETURNING member_id AS "id"`,
  });

  return EnvironmentMemberRepository.of({
    list: listRows.pipe(
      NodeSqliteClient.readOnly,
      Effect.mapError(toError("list")),
      Effect.withSpan("EnvironmentMemberRepository.list"),
    ),
    getById: Effect.fn("EnvironmentMemberRepository.getById")(function (id) {
      return getRowById({ id }).pipe(
        NodeSqliteClient.readOnly,
        Effect.mapError(toError("getById")),
      );
    }),
    getByEmail: Effect.fn("EnvironmentMemberRepository.getByEmail")(function (email) {
      return getRowByEmail({ email }).pipe(
        NodeSqliteClient.readOnly,
        Effect.mapError(toError("getByEmail")),
      );
    }),
    insert: Effect.fn("EnvironmentMemberRepository.insert")(function (record) {
      return insertRow(record).pipe(Effect.mapError(toError("insert")));
    }),
    update: Effect.fn("EnvironmentMemberRepository.update")(function (input) {
      return updateRow(input).pipe(Effect.mapError(toError("update")));
    }),
    bindCloudUser: Effect.fn("EnvironmentMemberRepository.bindCloudUser")(function (input) {
      return bindRow(input).pipe(Effect.mapError(toError("bindCloudUser")));
    }),
    delete: Effect.fn("EnvironmentMemberRepository.delete")(function (id) {
      return deleteRows({ id }).pipe(
        Effect.map((rows) => rows.length > 0),
        Effect.mapError(toError("delete")),
      );
    }),
  });
});

export const layer = Layer.effect(EnvironmentMemberRepository, make);
