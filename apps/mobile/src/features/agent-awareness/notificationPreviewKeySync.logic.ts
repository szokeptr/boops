import type { EnvironmentId } from "@t3tools/contracts";

export type NotificationPreviewKeyIntent =
  | { readonly kind: "register"; readonly publicKey: string }
  | { readonly kind: "remove" };

/** What an environment holds once it accepts `intent`: that public key, or none. */
export function syncedStateFor(intent: NotificationPreviewKeyIntent): string {
  return intent.kind === "register" ? intent.publicKey : "removed";
}

/** The connected environments that have not yet accepted `intent` this launch. */
export function environmentsNeedingNotificationPreviewKeySync(input: {
  readonly environmentIds: ReadonlyArray<EnvironmentId>;
  readonly intent: NotificationPreviewKeyIntent;
  readonly synced: ReadonlyMap<EnvironmentId, string>;
}): ReadonlyArray<EnvironmentId> {
  const wanted = syncedStateFor(input.intent);
  return input.environmentIds.filter((environmentId) => input.synced.get(environmentId) !== wanted);
}
