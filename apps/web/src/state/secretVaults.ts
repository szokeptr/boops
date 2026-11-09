import { createSecretVaultEnvironmentAtoms } from "@t3tools/client-runtime/state/secret-vaults";
import type { EnvironmentId, SecretVault } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../connection/runtime";
import { useEnvironmentQuery } from "./query";

export const secretVaultEnvironment = createSecretVaultEnvironmentAtoms(connectionAtomRuntime);

const NO_VAULTS: ReadonlyArray<SecretVault> = [];

/** The environment's vaults, live from `secretVaults.subscribe`. */
export function useSecretVaults(environmentId: EnvironmentId | null) {
  const query = useEnvironmentQuery(
    environmentId === null ? null : secretVaultEnvironment.vaults({ environmentId, input: {} }),
  );
  return {
    vaults: query.data?.vaults ?? NO_VAULTS,
    loaded: query.data !== null,
    error: query.data === null ? query.error : null,
  };
}
