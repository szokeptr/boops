import { connectorRedirectOrigin } from "@t3tools/client-runtime/connectors";
import { createConnectorEnvironmentAtoms } from "@t3tools/client-runtime/state/connectors";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import type { ConnectorCatalogEntry, ConnectorConnection, EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";

import { connectionAtomRuntime } from "../connection/runtime";
import { useProjects } from "./entities";
import { useEnvironmentQuery } from "./query";
import { usePreparedConnection } from "./session";

export const connectorEnvironment = createConnectorEnvironmentAtoms(connectionAtomRuntime);

const NO_ENTRIES: ReadonlyArray<ConnectorCatalogEntry> = [];
const NO_CONNECTIONS: ReadonlyArray<ConnectorConnection> = [];

export function useConnectorCatalog(environmentId: EnvironmentId | null) {
  const query = useEnvironmentQuery(
    environmentId === null ? null : connectorEnvironment.catalog({ environmentId, input: {} }),
  );
  return { entries: query.data?.entries ?? NO_ENTRIES, error: query.error };
}

/** The environment's connections, live from `connectors.subscribe`. */
export function useConnectorConnections(environmentId: EnvironmentId | null) {
  const query = useEnvironmentQuery(
    environmentId === null ? null : connectorEnvironment.connections({ environmentId, input: {} }),
  );
  return {
    connections: query.data?.connections ?? NO_CONNECTIONS,
    loaded: query.data !== null,
    error: query.data === null ? query.error : null,
  };
}

/** Where sign-ins return to: the server's origin as this app reaches it. */
export function useConnectorRedirect(environmentId: EnvironmentId | null) {
  const prepared = usePreparedConnection(environmentId);
  return connectorRedirectOrigin(Option.isSome(prepared) ? prepared.value.httpBaseUrl : null);
}

/** The environment's bots, the ones a connection can be turned on for. */
export function useEnvironmentBots(
  environmentId: EnvironmentId | null,
): ReadonlyArray<EnvironmentProject> {
  return useProjects().filter(
    (project) =>
      project.environmentId === environmentId && project.isScratch !== true && !project.archivedAt,
  );
}
