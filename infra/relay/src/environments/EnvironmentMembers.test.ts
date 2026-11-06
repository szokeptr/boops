import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import { linkHearsActivityRow } from "../agentActivity/AgentActivityRows.ts";
import { relayAgentActivityRows, relayEnvironmentLinks } from "../persistence/schema.ts";
import { acceptInviteStatement } from "./EnvironmentMembers.ts";

const migratedDatabase = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const pg = yield* Effect.acquireRelease(
    Effect.promise(() => PGlite.create()),
    (client) => Effect.promise(() => client.close()),
  );
  const migrationsDir = yield* path.fromFileUrl(
    new URL("../../migrations/postgres/", import.meta.url),
  );
  for (const name of (yield* fs.readDirectory(migrationsDir)).toSorted()) {
    const migration = yield* fs.readFileString(`${migrationsDir}${name}/migration.sql`);
    yield* Effect.promise(() => pg.exec(migration));
  }
  return pg;
});

const insertLink = (
  pg: PGlite,
  link: {
    readonly userId: string;
    readonly key?: string;
    readonly memberId?: string;
    readonly revokedAt?: string;
    readonly updatedAt?: string;
  },
) =>
  Effect.promise(() =>
    pg.query(
      `insert into relay_environment_links
        (user_id, environment_id, environment_label, environment_public_key, endpoint_http_base_url,
         endpoint_ws_base_url, endpoint_provider_kind, managed_tunnels_enabled, role, member_id,
         shared_by_user_id, revoked_at, created_at, updated_at)
        values ($1, 'env-1', 'Peter''s Mac', $2, 'https://env.example.test/', 'wss://env.example.test/ws',
                'cloudflare_tunnel', $3, $4, $5, $6, $7, 't0', $8)`,
      [
        link.userId,
        link.key ?? "key-1",
        link.memberId === undefined,
        link.memberId === undefined ? "owner" : "member",
        link.memberId ?? null,
        link.memberId === undefined ? null : "owner",
        link.revokedAt ?? null,
        link.updatedAt ?? "t0",
      ],
    ),
  );

const insertInvite = (pg: PGlite, memberId: string, email = "anna@example.test") =>
  Effect.promise(() =>
    pg.query(
      `insert into relay_environment_invites
        (environment_id, member_id, environment_public_key, email, member_label, environment_label,
         created_at, updated_at)
        values ('env-1', $1, 'key-1', $2, 'Anna', 'Peter''s Boops', 't0', 't0')`,
      [memberId, email],
    ),
  );

const accept = (pg: PGlite, input: { readonly userId: string; readonly email?: string }) =>
  Effect.promise(async () => {
    const query = new PgDialect().sqlToQuery(
      acceptInviteStatement({
        userId: input.userId,
        inviteId: "member-1",
        email: input.email ?? "anna@example.test",
        now: "t1",
      }),
    );
    return (await pg.query(query.sql, query.params)).rows;
  });

describe("EnvironmentMembers", () => {
  it.effect("accepts an invite into a member link that borrows the owner's endpoint", () =>
    Effect.gen(function* () {
      const pg = yield* migratedDatabase;
      yield* insertLink(pg, { userId: "owner", updatedAt: "t2" });
      yield* insertLink(pg, { userId: "previous-install", key: "old-key", updatedAt: "t3" });
      yield* insertLink(pg, { userId: "anna-as-owner" });
      yield* insertInvite(pg, "member-1");

      expect(yield* accept(pg, { userId: "anna", email: "someone@example.test" })).toEqual([]);
      // Never turns someone's active owner link into a member link.
      expect(yield* accept(pg, { userId: "anna-as-owner" })).toEqual([]);
      expect(yield* accept(pg, { userId: "anna" })).toEqual([
        {
          environment_id: "env-1",
          environment_label: "Peter's Mac",
          endpoint_http_base_url: "https://env.example.test/",
          endpoint_ws_base_url: "wss://env.example.test/ws",
          endpoint_provider_kind: "cloudflare_tunnel",
          created_at: "t1",
        },
      ]);
      const [link] = yield* Effect.promise(() =>
        drizzle({ client: pg })
          .select()
          .from(relayEnvironmentLinks)
          .where(eq(relayEnvironmentLinks.userId, "anna")),
      );
      expect(link).toMatchObject({
        role: "member",
        memberId: "member-1",
        sharedByUserId: "owner",
        environmentPublicKey: "key-1",
        managedTunnelsEnabled: false,
        notificationsEnabled: true,
        revokedAt: null,
      });
      const invites = yield* Effect.promise(() =>
        pg.query("select member_id from relay_environment_invites"),
      );
      expect(invites.rows).toEqual([]);
      expect(yield* accept(pg, { userId: "anna" })).toEqual([]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("delivers a member's threads only to that member and the rest only to owners", () =>
    Effect.gen(function* () {
      const pg = yield* migratedDatabase;
      yield* insertLink(pg, { userId: "owner" });
      yield* insertLink(pg, { userId: "anna", memberId: "member-anna" });
      yield* insertLink(pg, { userId: "bob", memberId: "member-bob" });
      for (const [threadId, memberId] of [
        ["owner-thread", undefined],
        ["anna-thread", "member-anna"],
      ] as const) {
        yield* Effect.promise(() =>
          pg.query(
            `insert into relay_agent_activity_rows
              (environment_id, environment_public_key, thread_id, state_json, updated_at, created_at)
              values ('env-1', 'key-1', $1, $2, 't0', 't0')`,
            [threadId, JSON.stringify({ threadId, ...(memberId ? { memberId } : {}) })],
          ),
        );
      }
      const heardBy = (userId: string) =>
        Effect.promise(() =>
          drizzle({ client: pg })
            .select({ threadId: relayAgentActivityRows.threadId })
            .from(relayAgentActivityRows)
            .innerJoin(
              relayEnvironmentLinks,
              eq(relayEnvironmentLinks.environmentId, relayAgentActivityRows.environmentId),
            )
            .where(and(eq(relayEnvironmentLinks.userId, userId), linkHearsActivityRow)),
        ).pipe(Effect.map((rows) => rows.map((row) => row.threadId)));
      expect(yield* heardBy("owner")).toEqual(["owner-thread"]);
      expect(yield* heardBy("anna")).toEqual(["anna-thread"]);
      expect(yield* heardBy("bob")).toEqual([]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
