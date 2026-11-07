import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Notifications from "expo-notifications";
import { AppState } from "react-native";

import { whenProtectedDataAvailable } from "../../lib/protectedData";
import { loadOrCreateAgentAwarenessDeviceId } from "../../persistence/imperative";
import { appAtomRegistry } from "../../state/atom-registry";
import { notificationKeyEnvironment } from "../../state/notificationKeys";
import { connectedEnvironmentIdsAtom } from "../../state/presentation";
import { supportsAgentAwarenessPush } from "./capabilities";
import {
  loadNotificationPreviewKeyPair,
  notificationPreviewKeyAccessGroup,
} from "./notificationPreviewKey";
import {
  environmentsNeedingNotificationPreviewKeySync,
  type NotificationPreviewKeyIntent,
  syncedStateFor,
} from "./notificationPreviewKeySync.logic";
import {
  getAgentAwarenessRegistrationStatus,
  subscribeAgentAwarenessRegistrationStatus,
} from "./remoteRegistration";

function logSyncError(context: string, error: unknown): void {
  if (!__DEV__) return;
  console.warn(`[agent-awareness] ${context}`, error);
}

/** Register while Device Notifications are on; remove once the system permission is gone. */
async function currentIntent(): Promise<NotificationPreviewKeyIntent | null> {
  const permissions = await Notifications.getPermissionsAsync();
  if (!permissions.granted) {
    // Never generate a key just to remove it.
    return (await loadNotificationPreviewKeyPair({ create: false })) ? { kind: "remove" } : null;
  }
  // Relay registration is what makes the toggle read as on; until then pushes cannot arrive.
  if (getAgentAwarenessRegistrationStatus() !== "registered") return null;
  const keyPair = await loadNotificationPreviewKeyPair({ create: true });
  return keyPair ? { kind: "register", publicKey: keyPair.publicKey } : null;
}

/**
 * Hands this phone's preview key to every connected environment, owned or joined as a member,
 * once per environment and key each launch. App-lifetime; iOS builds with the extension only.
 */
export function installNotificationPreviewKeySync(): () => void {
  if (!supportsAgentAwarenessPush() || notificationPreviewKeyAccessGroup() === null) {
    return () => {};
  }
  const synced = new Map<EnvironmentId, string>();
  let disposed = false;
  let running = false;
  let rerun = false;

  const run = async () => {
    await whenProtectedDataAvailable();
    const environmentIds = appAtomRegistry.get(connectedEnvironmentIdsAtom);
    if (environmentIds.length === 0) return;
    const intent = await currentIntent();
    if (!intent || disposed) return;
    const targets = environmentsNeedingNotificationPreviewKeySync({
      environmentIds,
      intent,
      synced,
    });
    if (targets.length === 0) return;
    const deviceId = await loadOrCreateAgentAwarenessDeviceId();
    await Promise.all(
      targets.map(async (environmentId) => {
        const result =
          intent.kind === "register"
            ? await notificationKeyEnvironment.registerDeviceKey.run(appAtomRegistry, {
                environmentId,
                input: { deviceId, publicKey: intent.publicKey },
              })
            : await notificationKeyEnvironment.removeDeviceKey.run(appAtomRegistry, {
                environmentId,
                input: { deviceId },
              });
        if (result._tag === "Success") {
          synced.set(environmentId, syncedStateFor(intent));
        } else {
          logSyncError(
            `notification preview key ${intent.kind} failed`,
            squashAtomCommandFailure(result),
          );
        }
      }),
    );
  };

  // One pass at a time; a trigger during a pass runs one more afterwards.
  const reconcile = () => {
    if (disposed) return;
    if (running) {
      rerun = true;
      return;
    }
    running = true;
    void run()
      .catch((error: unknown) => logSyncError("notification preview key sync failed", error))
      .finally(() => {
        running = false;
        if (rerun) {
          rerun = false;
          reconcile();
        }
      });
  };

  const unsubscribeEnvironments = appAtomRegistry.subscribe(
    connectedEnvironmentIdsAtom,
    reconcile,
    { immediate: true },
  );
  const unsubscribeStatus = subscribeAgentAwarenessRegistrationStatus(reconcile);
  // Permission changes in system Settings are only visible on return.
  const appState = AppState.addEventListener("change", (state) => {
    if (state === "active") reconcile();
  });
  return () => {
    disposed = true;
    unsubscribeEnvironments();
    unsubscribeStatus();
    appState.remove();
  };
}
