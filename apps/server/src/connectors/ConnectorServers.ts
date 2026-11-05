import type { ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";

import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";

/** The T3 server's proxy path for one connection; see ConnectorProxyHttp.ts. */
export const CONNECTOR_PROXY_PATH = "/mcp-connectors";

/**
 * Which connectors a thread's bot uses right now. Kept apart from `Connectors` so the provider
 * session manager can read it without depending on orchestration.
 */
export class ConnectorServers extends Context.Service<
  ConnectorServers,
  {
    /** Server names of the connected connections turned on for the thread's bot. */
    readonly forThread: (threadId: ThreadId) => Effect.Effect<ReadonlyArray<string>>;
  }
>()("t3/connectors/ConnectorServers") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const projectionStore = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectStore.ProjectStoreV2;

  const forThread: ConnectorServers["Service"]["forThread"] = Effect.fn(
    "ConnectorServers.forThread",
  )(
    function* (threadId) {
      const thread = yield* projectionStore.getThread(threadId);
      const project = yield* projects.get(thread.projectId);
      const ids = Option.match(project, {
        onNone: () => [],
        onSome: (row) => row.connectionIds,
      });
      if (ids.length === 0) return [];
      const rows = yield* sql<{ readonly server_name: string }>`
        SELECT server_name FROM connector_connections
        WHERE status = 'connected' AND connection_id IN ${sql.in(ids)}
        ORDER BY server_name
      `;
      return rows.map((row) => row.server_name);
    },
    // A turn must start even when this read fails; the bot then runs without connectors.
    (effect, threadId) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Could not read the bot's connectors", { threadId, cause }).pipe(
            Effect.as([]),
          ),
        ),
      ),
  );

  return ConnectorServers.of({ forThread });
});

export const layer = Layer.effect(ConnectorServers, make);
