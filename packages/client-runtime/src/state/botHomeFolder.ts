import type {
  EnvironmentId,
  ModelSelection,
  ProviderInstanceId,
  ServerProvider,
  ThreadId,
} from "@t3tools/contracts";

/** Why the provider a bot runs on cannot keep it in its home folder, if any member's cannot. */
export function botHomeFolderUnavailableReason(
  members: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly mainThreadId?: ThreadId | null | undefined;
    readonly defaultModelSelection?: ModelSelection | null | undefined;
  }>,
  threads: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly id: ThreadId;
    readonly providerInstanceId: ProviderInstanceId;
  }>,
  providersByEnvironment: ReadonlyMap<EnvironmentId, ReadonlyArray<ServerProvider>>,
): string | undefined {
  for (const member of members) {
    // The conversation's provider wins: a model switch moves the bot to another one.
    const instanceId =
      threads.find(
        (thread) =>
          thread.environmentId === member.environmentId && thread.id === member.mainThreadId,
      )?.providerInstanceId ?? member.defaultModelSelection?.instanceId;
    const reason = providersByEnvironment
      .get(member.environmentId)
      ?.find((provider) => provider.instanceId === instanceId)?.homeFolderUnavailableReason;
    if (reason !== undefined) return reason;
  }
  return undefined;
}
