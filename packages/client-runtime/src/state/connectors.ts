import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

/**
 * An environment's connectors. `connections` follows `connectors.subscribe`, which sends the
 * whole list again after every change, so commands need no refresh: a finished sign-in, a test
 * or a removal reaches every reader through the stream. Bots' `connectionIds` arrive with their
 * project shells.
 */
export function createConnectorEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    // The catalog is compiled into the server, so it changes only with an update.
    catalog: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:connectors:catalog",
      tag: WS_METHODS.connectorsListCatalog,
      staleTimeMs: 60 * 60_000,
    }),
    connections: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:connectors:connections",
      tag: WS_METHODS.connectorsSubscribe,
    }),
    detectAuth: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:connectors:detect-auth",
      tag: WS_METHODS.connectorsDetectAuth,
    }),
    startOAuth: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:connectors:start-oauth",
      tag: WS_METHODS.connectorsStartOAuth,
    }),
    addConnection: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:connectors:add",
      tag: WS_METHODS.connectorsAddConnection,
    }),
    rename: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:connectors:rename",
      tag: WS_METHODS.connectorsRename,
    }),
    reauthenticate: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:connectors:reauthenticate",
      tag: WS_METHODS.connectorsReauthenticate,
    }),
    disconnect: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:connectors:disconnect",
      tag: WS_METHODS.connectorsDisconnect,
    }),
    remove: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:connectors:remove",
      tag: WS_METHODS.connectorsRemove,
    }),
    test: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:connectors:test",
      tag: WS_METHODS.connectorsTest,
    }),
    setBotConnection: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:connectors:set-bot-connection",
      tag: WS_METHODS.connectorsSetBotConnection,
    }),
    // One answer per card at a time.
    answerRequest: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:connectors:answer-request",
      tag: WS_METHODS.connectorsAnswerRequest,
      concurrency: {
        mode: "singleFlight",
        key: ({ environmentId, input }) =>
          JSON.stringify([environmentId, input.threadId, input.turnItemId]),
      },
    }),
  };
}
