import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

/**
 * An environment's secret vaults. `vaults` follows `secretVaults.subscribe`, which sends the whole
 * list again after every change, so commands need no refresh. Values never reach clients.
 */
export function createSecretVaultEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    vaults: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:secret-vaults",
      tag: WS_METHODS.secretVaultsSubscribe,
    }),
    create: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:secret-vaults:create",
      tag: WS_METHODS.secretVaultsCreate,
    }),
    rename: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:secret-vaults:rename",
      tag: WS_METHODS.secretVaultsRename,
    }),
    remove: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:secret-vaults:remove",
      tag: WS_METHODS.secretVaultsRemove,
    }),
    setBot: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:secret-vaults:set-bot",
      tag: WS_METHODS.secretVaultsSetBot,
    }),
    putEntry: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:secret-vaults:put-entry",
      tag: WS_METHODS.secretVaultsPutEntry,
    }),
    removeEntry: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:secret-vaults:remove-entry",
      tag: WS_METHODS.secretVaultsRemoveEntry,
    }),
  };
}
