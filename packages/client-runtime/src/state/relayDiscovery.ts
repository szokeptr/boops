import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AsyncResult, Atom } from "effect/reactivity";

import * as RelayEnvironmentDiscovery from "../relay/discovery.ts";
import { createRuntimeCommand } from "./runtime.ts";

export function createRelayEnvironmentDiscoveryAtoms<R, E>(
  runtime: Atom.AtomRuntime<RelayEnvironmentDiscovery.RelayEnvironmentDiscovery | R, E>,
) {
  const stateAtom = runtime.atom(
    Stream.unwrap(
      RelayEnvironmentDiscovery.RelayEnvironmentDiscovery.pipe(
        Effect.map((discovery) => SubscriptionRef.changes(discovery.state)),
      ),
    ),
    { initialValue: RelayEnvironmentDiscovery.EMPTY_RELAY_ENVIRONMENT_DISCOVERY_STATE },
  );
  const stateValueAtom = Atom.make((get) =>
    AsyncResult.getOrElse(
      get(stateAtom),
      () => RelayEnvironmentDiscovery.EMPTY_RELAY_ENVIRONMENT_DISCOVERY_STATE,
    ),
  ).pipe(Atom.withLabel("relay-environment-discovery-value"));
  const refresh = createRuntimeCommand(runtime, {
    label: "relay-environment-discovery:refresh",
    concurrency: { mode: "singleFlight", key: () => "refresh" },
    execute: (_input: void) =>
      RelayEnvironmentDiscovery.RelayEnvironmentDiscovery.pipe(
        Effect.flatMap((discovery) => discovery.refresh),
      ),
  });

  const refreshAfterMutation = createRuntimeCommand(runtime, {
    label: "relay-environment-discovery:refresh-after-mutation",
    concurrency: { mode: "serial", key: () => "refresh-after-mutation" },
    execute: (_input: void) =>
      RelayEnvironmentDiscovery.RelayEnvironmentDiscovery.pipe(
        Effect.flatMap((discovery) => discovery.refresh),
      ),
  });

  // One answer per invite; a second tap while the first is in flight joins it.
  const acceptInvite = createRuntimeCommand(runtime, {
    label: "relay-environment-discovery:accept-invite",
    concurrency: { mode: "singleFlight", key: (inviteId: string) => inviteId },
    execute: (inviteId: string) =>
      RelayEnvironmentDiscovery.RelayEnvironmentDiscovery.pipe(
        Effect.flatMap((discovery) => discovery.acceptInvite(inviteId)),
      ),
  });
  const declineInvite = createRuntimeCommand(runtime, {
    label: "relay-environment-discovery:decline-invite",
    concurrency: { mode: "singleFlight", key: (inviteId: string) => inviteId },
    execute: (inviteId: string) =>
      RelayEnvironmentDiscovery.RelayEnvironmentDiscovery.pipe(
        Effect.flatMap((discovery) => discovery.declineInvite(inviteId)),
      ),
  });

  return {
    stateAtom,
    stateValueAtom,
    refresh,
    refreshAfterMutation,
    acceptInvite,
    declineInvite,
  };
}
