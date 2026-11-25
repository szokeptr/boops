import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

const pushWakeupListeners = new Set<() => void>();

/**
 * A push woke the suspended app: its sockets may have died while it slept, so connections
 * recover as after a long background stay. A no-op before the connection runtime starts.
 */
export function wakeConnectionsForPush(): void {
  for (const listener of pushWakeupListeners) listener();
}

export const pushWakeups = Stream.callback<"application-active-long">((queue) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const listener = () => Queue.offerUnsafe(queue, "application-active-long");
      pushWakeupListeners.add(listener);
      return listener;
    }),
    (listener) => Effect.sync(() => pushWakeupListeners.delete(listener)),
  ).pipe(Effect.asVoid),
);
