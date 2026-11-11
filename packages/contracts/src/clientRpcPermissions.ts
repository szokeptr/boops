import * as Schema from "effect/Schema";
import { GitPreparePullRequestThreadInput, GitRunStackedActionInput } from "./git.ts";
import {
  AuthAccessWriteScope,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthPreviewOperateScope,
  AuthSettingsWriteScope,
  AuthSourceControlWriteScope,
  AuthTerminalOperateScope,
  type AuthEnvironmentScope,
} from "./auth.ts";
import { ORCHESTRATION_V2_WS_METHODS } from "./orchestrationV2.ts";
import { WS_METHODS } from "./rpc.ts";

/** Incremental client enforcement; the server still authorizes every request. */
export const CLIENT_GUARDED_RPC_SCOPES = {
  [WS_METHODS.previewClose]: AuthPreviewOperateScope,
  // Stopping a server signals its processes, as closing a terminal does.
  [WS_METHODS.previewStopLocalServer]: AuthTerminalOperateScope,
  [WS_METHODS.serverRunStorageCleanup]: AuthSettingsWriteScope,
  [WS_METHODS.serverCheckOtlpEndpoint]: AuthSettingsWriteScope,
  [WS_METHODS.serverRefreshProviders]: AuthOrchestrationReadScope,
  [WS_METHODS.pullRequestsRunAction]: AuthSourceControlWriteScope,
  [WS_METHODS.pullRequestsUpdate]: AuthSourceControlWriteScope,
  [WS_METHODS.pullRequestsComment]: AuthSourceControlWriteScope,
  [WS_METHODS.pullRequestsUpdateComment]: AuthSourceControlWriteScope,
  [WS_METHODS.pullRequestsSubmitReview]: AuthSourceControlWriteScope,
  [WS_METHODS.pullRequestsReplyToThread]: AuthSourceControlWriteScope,
  [WS_METHODS.pullRequestsSetThreadResolution]: AuthSourceControlWriteScope,
  [WS_METHODS.pullRequestsSetReaction]: AuthSourceControlWriteScope,
  [WS_METHODS.pullRequestsSetFilesViewed]: AuthSourceControlWriteScope,
  [WS_METHODS.pullRequestsRequestReviewers]: AuthSourceControlWriteScope,
  [WS_METHODS.pullRequestsSetLabels]: AuthSourceControlWriteScope,
  // Writing a guide runs a model on this environment's providers, which reading one does not.
  [WS_METHODS.pullRequestsGenerateReviewGuide]: AuthOrchestrationOperateScope,
  [WS_METHODS.projectsCreateFromThread]: AuthOrchestrationOperateScope,
  [WS_METHODS.botsCreate]: AuthOrchestrationOperateScope,
  [WS_METHODS.botsArchive]: AuthOrchestrationOperateScope,
  [WS_METHODS.botsUnarchive]: AuthOrchestrationOperateScope,
  [WS_METHODS.botsDelete]: AuthOrchestrationOperateScope,
  [WS_METHODS.botsCallStart]: AuthOrchestrationOperateScope,
  [WS_METHODS.botsCallEnd]: AuthOrchestrationOperateScope,
  // Room rules (who may create, add or remove) are the Rooms service's; these are the floor.
  [WS_METHODS.roomsCreate]: AuthOrchestrationOperateScope,
  [WS_METHODS.roomsRename]: AuthOrchestrationOperateScope,
  [WS_METHODS.roomsAddParticipant]: AuthOrchestrationOperateScope,
  [WS_METHODS.roomsSetListening]: AuthOrchestrationOperateScope,
  [WS_METHODS.roomsRemoveParticipant]: AuthOrchestrationOperateScope,
  [WS_METHODS.roomsSetArchived]: AuthOrchestrationOperateScope,
  [WS_METHODS.roomsDelete]: AuthOrchestrationOperateScope,
  [WS_METHODS.roomsPost]: AuthOrchestrationOperateScope,
  [WS_METHODS.roomsRespond]: AuthOrchestrationOperateScope,
  [WS_METHODS.roomsInterrupt]: AuthOrchestrationOperateScope,
  // Inviting someone hands them access to this environment, like a pairing link.
  [WS_METHODS.membersInvite]: AuthAccessWriteScope,
  [WS_METHODS.membersUpdate]: AuthAccessWriteScope,
  [WS_METHODS.membersRemove]: AuthAccessWriteScope,
  [WS_METHODS.membersSetBotAccess]: AuthAccessWriteScope,
  [WS_METHODS.membersSetBotConnectionAccess]: AuthAccessWriteScope,
  [WS_METHODS.sourceControlCloneRepository]: AuthSourceControlWriteScope,
  [WS_METHODS.sourceControlPublishRepository]: AuthSourceControlWriteScope,
  [WS_METHODS.sourceControlStar]: AuthSourceControlWriteScope,
  // Signing in replaces the server's GitHub credential, as saving a token in Settings does.
  [WS_METHODS.sourceControlSignInStart]: AuthSettingsWriteScope,
  [WS_METHODS.sourceControlSignInWait]: AuthSettingsWriteScope,
  [WS_METHODS.sourceControlSignInCancel]: AuthSettingsWriteScope,
  [WS_METHODS.projectCloneStart]: AuthSourceControlWriteScope,
  [WS_METHODS.projectCloneCancel]: AuthSourceControlWriteScope,
  [WS_METHODS.projectCloneRetry]: AuthSourceControlWriteScope,
  [WS_METHODS.vcsPull]: AuthSourceControlWriteScope,
  [WS_METHODS.gitRunStackedAction]: AuthSourceControlWriteScope,
  [WS_METHODS.gitPreparePullRequestThread]: AuthSourceControlWriteScope,
  [WS_METHODS.vcsCreateWorktree]: AuthSourceControlWriteScope,
  [WS_METHODS.vcsRemoveWorktree]: AuthSourceControlWriteScope,
  [WS_METHODS.vcsCreateRef]: AuthSourceControlWriteScope,
  [WS_METHODS.vcsSwitchRef]: AuthSourceControlWriteScope,
  [WS_METHODS.vcsInit]: AuthSourceControlWriteScope,

  // Starts an agent session on this environment that can read its logs and database.
  [WS_METHODS.serverPrepareTriage]: AuthOrchestrationOperateScope,
  [WS_METHODS.scheduledTasksUpsert]: AuthOrchestrationOperateScope,
  [WS_METHODS.scheduledTasksSetEnabled]: AuthOrchestrationOperateScope,
  [WS_METHODS.scheduledTasksDelete]: AuthOrchestrationOperateScope,
  [WS_METHODS.scheduledTasksRunNow]: AuthOrchestrationOperateScope,
  [WS_METHODS.scheduledTasksRotateWebhookToken]: AuthOrchestrationOperateScope,
  [ORCHESTRATION_V2_WS_METHODS.stopWorkflow]: AuthOrchestrationOperateScope,
  // Force stop kills agent processes, as Stop on a terminal does.
  [ORCHESTRATION_V2_WS_METHODS.forceStopThread]: AuthOrchestrationOperateScope,
  // A guest link hands thread access to someone outside, like a pairing link.
  [WS_METHODS.guestShareCreate]: AuthAccessWriteScope,
  [WS_METHODS.peerLinksLink]: AuthAccessWriteScope,
  [WS_METHODS.peerLinksUnlink]: AuthAccessWriteScope,
  // A link lets every agent here reach the other environment: Settings' bar.
  [WS_METHODS.peerLinksAnswerRequest]: AuthAccessWriteScope,
  // Connections hold third-party credentials and decide what bots can reach, as settings do.
  [WS_METHODS.connectorsStartOAuth]: AuthSettingsWriteScope,
  [WS_METHODS.connectorsAddConnection]: AuthSettingsWriteScope,
  [WS_METHODS.connectorsRename]: AuthSettingsWriteScope,
  [WS_METHODS.connectorsReauthenticate]: AuthSettingsWriteScope,
  [WS_METHODS.connectorsDisconnect]: AuthSettingsWriteScope,
  [WS_METHODS.connectorsRemove]: AuthSettingsWriteScope,
  [WS_METHODS.connectorsTest]: AuthSettingsWriteScope,
  [WS_METHODS.connectorsSetBotConnection]: AuthSettingsWriteScope,
  [WS_METHODS.secretVaultsCreate]: AuthSettingsWriteScope,
  [WS_METHODS.secretVaultsRename]: AuthSettingsWriteScope,
  [WS_METHODS.secretVaultsRemove]: AuthSettingsWriteScope,
  [WS_METHODS.secretVaultsSetBot]: AuthSettingsWriteScope,
  [WS_METHODS.secretVaultsPutEntry]: AuthSettingsWriteScope,
  [WS_METHODS.secretVaultsRemoveEntry]: AuthSettingsWriteScope,
  [WS_METHODS.connectorsAnswerRequest]: AuthSettingsWriteScope,
  // Probing sends a request to a URL the client names.
  [WS_METHODS.connectorsDetectAuth]: AuthSettingsWriteScope,
} as const;
export type ClientGuardedRpcTag = keyof typeof CLIENT_GUARDED_RPC_SCOPES;

const decodePrepareThread = Schema.decodeUnknownSync(GitPreparePullRequestThreadInput);
const decodeStackedAction = Schema.decodeUnknownSync(GitRunStackedActionInput);

export function clientRpcRequiredScopes(
  method: string,
  input: unknown,
): readonly AuthEnvironmentScope[] {
  if (method === WS_METHODS.gitPreparePullRequestThread && input !== undefined) {
    const payload = decodePrepareThread(input);
    if (payload.mode === "worktree" && payload.threadId !== undefined)
      return [AuthSourceControlWriteScope, AuthOrchestrationOperateScope];
  }
  if (method === WS_METHODS.gitRunStackedAction && input !== undefined) {
    const payload = decodeStackedAction(input);
    if (
      payload.threadId !== undefined &&
      (payload.action === "create_pr" || payload.action === "commit_push_pr")
    )
      return [AuthSourceControlWriteScope, AuthOrchestrationReadScope];
  }
  return Object.hasOwn(CLIENT_GUARDED_RPC_SCOPES, method)
    ? [CLIENT_GUARDED_RPC_SCOPES[method as ClientGuardedRpcTag]]
    : [];
}
