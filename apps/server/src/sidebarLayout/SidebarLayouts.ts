/**
 * Each viewer's sidebar sections, kept on the server so every client they use shows the same
 * layout. A viewer is the owner, or the member a session belongs to.
 */
import {
  EMPTY_SIDEBAR_LAYOUT,
  type EnvironmentMemberId,
  SidebarLayout,
  SidebarLayoutError,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

const viewerKeyOf = (memberId: EnvironmentMemberId | undefined) =>
  memberId === undefined ? "owner" : `member:${memberId}`;

const decodeLayout = Schema.decodeUnknownEffect(Schema.fromJsonString(SidebarLayout));
const encodeLayout = Schema.encodeEffect(Schema.fromJsonString(SidebarLayout));

const persistence = (cause: unknown) => new SidebarLayoutError({ cause });

export class SidebarLayouts extends Context.Service<
  SidebarLayouts,
  {
    /** The viewer's layout now, then again after any of their clients changes it. */
    readonly subscribe: (
      memberId: EnvironmentMemberId | undefined,
    ) => Stream.Stream<SidebarLayout, SidebarLayoutError>;
    readonly set: (
      memberId: EnvironmentMemberId | undefined,
      layout: SidebarLayout,
    ) => Effect.Effect<void, SidebarLayoutError>;
  }
>()("boops/sidebarLayout/SidebarLayouts") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const changes = yield* PubSub.unbounded<string>();

  const read = Effect.fn("SidebarLayouts.read")(function* (viewerKey: string) {
    const rows = yield* sql<{ readonly layoutJson: string }>`
      SELECT layout_json AS "layoutJson" FROM sidebar_layouts WHERE viewer_key = ${viewerKey}
    `.pipe(NodeSqliteClient.readOnly, Effect.mapError(persistence));
    const row = rows[0];
    if (row === undefined) return EMPTY_SIDEBAR_LAYOUT;
    // A layout this build cannot read starts over rather than locking the viewer out.
    return yield* decodeLayout(row.layoutJson).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Unreadable sidebar layout", { cause }).pipe(
          Effect.as(EMPTY_SIDEBAR_LAYOUT),
        ),
      ),
    );
  });

  const subscribe: SidebarLayouts["Service"]["subscribe"] = (memberId) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const viewerKey = viewerKeyOf(memberId);
        // Subscribe before the first read so no change between them is missed.
        const signals = yield* PubSub.subscribe(changes);
        return Stream.concat(
          Stream.fromEffect(read(viewerKey)),
          Stream.fromSubscription(signals).pipe(
            Stream.filter((changed) => changed === viewerKey),
            Stream.mapEffect(() => read(viewerKey)),
          ),
        );
      }),
    );

  const set: SidebarLayouts["Service"]["set"] = Effect.fn("SidebarLayouts.set")(
    function* (memberId, layout) {
      const viewerKey = viewerKeyOf(memberId);
      const layoutJson = yield* encodeLayout(layout).pipe(Effect.mapError(persistence));
      const updatedAt = DateTime.formatIso(yield* DateTime.now);
      yield* sql`
        INSERT INTO sidebar_layouts (viewer_key, layout_json, updated_at)
        VALUES (${viewerKey}, ${layoutJson}, ${updatedAt})
        ON CONFLICT (viewer_key) DO UPDATE SET
          layout_json = excluded.layout_json,
          updated_at = excluded.updated_at
      `.pipe(Effect.mapError(persistence));
      yield* PubSub.publish(changes, viewerKey);
    },
  );

  return SidebarLayouts.of({ subscribe, set });
});

export const layer = Layer.effect(SidebarLayouts, make);
