import {
  CLIENT_GUARDED_RPC_SCOPES,
  type DeviceListInput,
  clientRpcRequiredScopes,
  authScopeRequiredResponse,
  AssetCreateUrlInput,
  AuthAccessReadScope,
  ServerSettingsPatch,
  ProviderInstanceMutation,
  requiredScopesForServerSettingsPatch,
  requiredScopesForProjectMutation,
  ProjectMutation,
  AuthSettingsWriteScope,
  AuthProvidersManageScope,
  AuthEnvironmentMaintainScope,
  AuthFilesystemReadScope,
  AuthFilesystemWriteScope,
  AuthDiagnosticsReadScope,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthPreviewOperateScope,
  AuthRelayReadScope,
  AuthRelayWriteScope,
  AuthTerminalOperateScope,
  ORCHESTRATION_V2_WS_METHODS,
  AuthTerminalReadScope,
  type AuthEnvironmentScope,
  type EnvironmentMemberId,
  EnvironmentAuthorizationError,
  RpcScopeAuthorization,
  WS_METHODS,
  WsRpcGroup,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Layer from "effect/Layer";
import type * as RpcGroup from "effect/rpc/RpcGroup";

import { memberDenied } from "../members/memberFence.ts";

type WsRpcMethod = RpcGroup.Rpcs<typeof WsRpcGroup>["_tag"];

export const RPC_REQUIRED_SCOPES = {
  ...CLIENT_GUARDED_RPC_SCOPES,
  [ORCHESTRATION_V2_WS_METHODS.dispatchCommand]: AuthOrchestrationOperateScope,
  [ORCHESTRATION_V2_WS_METHODS.getWorkflowScript]: AuthOrchestrationReadScope,
  [ORCHESTRATION_V2_WS_METHODS.getNativeChildWork]: AuthOrchestrationReadScope,
  [ORCHESTRATION_V2_WS_METHODS.stopWorkflow]: AuthOrchestrationOperateScope,
  [ORCHESTRATION_V2_WS_METHODS.forceStopThread]: AuthOrchestrationOperateScope,
  [ORCHESTRATION_V2_WS_METHODS.getTurnDiff]: AuthOrchestrationReadScope,
  [ORCHESTRATION_V2_WS_METHODS.getFullThreadDiff]: AuthOrchestrationReadScope,
  [ORCHESTRATION_V2_WS_METHODS.searchThreads]: AuthOrchestrationReadScope,
  [ORCHESTRATION_V2_WS_METHODS.searchThread]: AuthOrchestrationReadScope,
  [ORCHESTRATION_V2_WS_METHODS.searchThreadStream]: AuthOrchestrationReadScope,
  [ORCHESTRATION_V2_WS_METHODS.getArchivedShellSnapshot]: AuthOrchestrationReadScope,
  [ORCHESTRATION_V2_WS_METHODS.getThreadFamily]: AuthOrchestrationReadScope,
  [ORCHESTRATION_V2_WS_METHODS.getWorktreeThreadIds]: AuthOrchestrationReadScope,
  [ORCHESTRATION_V2_WS_METHODS.getOlderSettledThreads]: AuthOrchestrationReadScope,
  [ORCHESTRATION_V2_WS_METHODS.getThreadProjection]: AuthOrchestrationReadScope,
  [ORCHESTRATION_V2_WS_METHODS.getTurnItem]: AuthOrchestrationReadScope,
  [ORCHESTRATION_V2_WS_METHODS.launchThread]: AuthOrchestrationOperateScope,
  [ORCHESTRATION_V2_WS_METHODS.subscribeShell]: AuthOrchestrationReadScope,
  [ORCHESTRATION_V2_WS_METHODS.subscribeThread]: AuthOrchestrationReadScope,
  [ORCHESTRATION_V2_WS_METHODS.subscribeCommandOutput]: AuthOrchestrationReadScope,
  [WS_METHODS.projectsMutate]: AuthOrchestrationOperateScope,
  [WS_METHODS.serverProbe]: AuthOrchestrationReadScope,
  [WS_METHODS.serverGetConfig]: AuthOrchestrationReadScope,
  [WS_METHODS.serverGetNpmRelease]: AuthOrchestrationReadScope,
  [WS_METHODS.serverRefreshProviders]: AuthOrchestrationReadScope,
  [WS_METHODS.serverUpdateProvider]: AuthProvidersManageScope,
  [WS_METHODS.providerAuthStart]: AuthProvidersManageScope,
  [WS_METHODS.providerConsumeResetCredit]: AuthProvidersManageScope,
  [WS_METHODS.providerAuthComplete]: AuthProvidersManageScope,
  [WS_METHODS.chatGptReconnectProfile]: AuthProvidersManageScope,
  [WS_METHODS.chatGptImportProfile]: AuthProvidersManageScope,
  [WS_METHODS.chatGptHandoffSubscribe]: AuthProvidersManageScope,
  [WS_METHODS.providerAuthRespond]: AuthProvidersManageScope,
  [WS_METHODS.providerAuthCancel]: AuthProvidersManageScope,
  [WS_METHODS.providerAuthLogout]: AuthProvidersManageScope,
  [WS_METHODS.providerAuthSubscribe]: AuthProvidersManageScope,
  [WS_METHODS.providerInstallStart]: AuthProvidersManageScope,
  [WS_METHODS.providerInstallCancel]: AuthProvidersManageScope,
  [WS_METHODS.providerInstallSubscribe]: AuthOrchestrationReadScope,
  [WS_METHODS.providerInstallRemove]: AuthProvidersManageScope,
  [WS_METHODS.serverUpdateServer]: AuthEnvironmentMaintainScope,
  [WS_METHODS.serverUpdateServerWithProgress]: AuthEnvironmentMaintainScope,
  [WS_METHODS.serverCommitDesktopUpdate]: AuthEnvironmentMaintainScope,
  [WS_METHODS.serverUpsertKeybinding]: AuthSettingsWriteScope,
  [WS_METHODS.serverRemoveKeybinding]: AuthSettingsWriteScope,
  [WS_METHODS.serverGetStorageCleanupReport]: AuthOrchestrationReadScope,
  [WS_METHODS.serverGetDatabaseStorage]: AuthOrchestrationReadScope,
  [WS_METHODS.peerLinksList]: AuthAccessReadScope,
  [WS_METHODS.connectorsListCatalog]: AuthOrchestrationReadScope,
  [WS_METHODS.connectorsList]: AuthOrchestrationReadScope,
  [WS_METHODS.connectorsSubscribe]: AuthOrchestrationReadScope,
  [WS_METHODS.secretVaultsSubscribe]: AuthOrchestrationReadScope,
  [WS_METHODS.serverUpdateSettings]: AuthSettingsWriteScope,
  [WS_METHODS.serverSearchAcpRegistry]: AuthOrchestrationReadScope,
  [WS_METHODS.serverPrepareAcpRegistryAgent]: AuthProvidersManageScope,
  [WS_METHODS.serverUninstallAcpRegistryManagedBinary]: AuthProvidersManageScope,
  [WS_METHODS.serverAcceptAcpRegistryUrlAuth]: AuthProvidersManageScope,
  [WS_METHODS.serverListAcpRegistrySessions]: AuthOrchestrationReadScope,
  [WS_METHODS.serverImportAcpRegistrySession]: AuthOrchestrationOperateScope,
  [WS_METHODS.serverDeleteAcpRegistrySession]: AuthOrchestrationOperateScope,
  [WS_METHODS.serverListAcpRegistryProviders]: AuthOrchestrationReadScope,
  [WS_METHODS.serverSetAcpRegistryProvider]: AuthProvidersManageScope,
  [WS_METHODS.serverDisableAcpRegistryProvider]: AuthProvidersManageScope,
  [WS_METHODS.serverLogoutAcpRegistry]: AuthProvidersManageScope,
  [WS_METHODS.serverDiscoverSourceControl]: AuthOrchestrationReadScope,
  [WS_METHODS.serverGetTraceDiagnostics]: AuthDiagnosticsReadScope,
  [WS_METHODS.serverGetProcessDiagnostics]: AuthDiagnosticsReadScope,
  // Thread load balancing reads host load, so it needs thread scope rather than diagnostics scope.
  [WS_METHODS.serverGetHostResources]: AuthOrchestrationReadScope,
  [WS_METHODS.serverGetProcessResourceHistory]: AuthDiagnosticsReadScope,
  [WS_METHODS.serverGetResourceTelemetryHistory]: AuthDiagnosticsReadScope,
  [WS_METHODS.serverRetryResourceTelemetry]: AuthDiagnosticsReadScope,
  [WS_METHODS.serverGetUsageSummary]: AuthDiagnosticsReadScope,
  [WS_METHODS.serverRefreshUsageRates]: AuthDiagnosticsReadScope,
  [WS_METHODS.serverSignalProcess]: AuthEnvironmentMaintainScope,
  [WS_METHODS.serverReportClientActivity]: AuthOrchestrationReadScope,
  [WS_METHODS.scheduledTasksSubscribe]: AuthOrchestrationReadScope,
  [WS_METHODS.secretsAnswerRequest]: AuthOrchestrationOperateScope,
  // Delivery logs hold request bodies, so they need the same scope as the URL.
  [WS_METHODS.scheduledTasksListWebhookDeliveries]: AuthOrchestrationOperateScope,
  [WS_METHODS.scheduledTasksGetWebhookDelivery]: AuthOrchestrationOperateScope,
  [WS_METHODS.cloudGetRelayClientStatus]: AuthRelayReadScope,
  [WS_METHODS.cloudInstallRelayClient]: AuthRelayWriteScope,
  [WS_METHODS.pullRequestsList]: AuthOrchestrationReadScope,
  [WS_METHODS.pullRequestsListStats]: AuthOrchestrationReadScope,
  [WS_METHODS.pullRequestsFilterOptions]: AuthOrchestrationReadScope,
  [WS_METHODS.pullRequestsSummary]: AuthOrchestrationReadScope,
  [WS_METHODS.pullRequestsRouting]: AuthOrchestrationReadScope,
  [WS_METHODS.pullRequestsRoutingIdentity]: AuthOrchestrationReadScope,
  [WS_METHODS.pullRequestsStack]: AuthOrchestrationReadScope,
  [WS_METHODS.pullRequestsLinkedThreads]: AuthOrchestrationReadScope,
  [WS_METHODS.pullRequestsDetail]: AuthOrchestrationReadScope,
  [WS_METHODS.pullRequestsPreview]: AuthOrchestrationReadScope,
  [WS_METHODS.pullRequestsChecks]: AuthOrchestrationReadScope,
  [WS_METHODS.pullRequestsActivity]: AuthOrchestrationReadScope,
  [WS_METHODS.pullRequestsReviewGuide]: AuthOrchestrationReadScope,
  [WS_METHODS.pullRequestsThreadComments]: AuthOrchestrationReadScope,
  [WS_METHODS.pullRequestsDiffFileContents]: AuthOrchestrationReadScope,
  [WS_METHODS.pullRequestsFilesViewed]: AuthOrchestrationReadScope,
  [WS_METHODS.pullRequestsChangeBreakdown]: AuthOrchestrationReadScope,
  [WS_METHODS.pullRequestsInvalidate]: AuthOrchestrationReadScope,
  [WS_METHODS.pullRequestsReportState]: AuthOrchestrationReadScope,
  [WS_METHODS.pullRequestsSubscribeRefreshes]: AuthOrchestrationReadScope,
  [WS_METHODS.pullRequestsReviewerCandidates]: AuthOrchestrationReadScope,
  [WS_METHODS.pullRequestsLabelCandidates]: AuthOrchestrationReadScope,
  [WS_METHODS.sourceControlLookupRepository]: AuthOrchestrationReadScope,
  [WS_METHODS.sourceControlAppAccess]: AuthOrchestrationReadScope,
  [WS_METHODS.sourceControlStarred]: AuthOrchestrationReadScope,
  [WS_METHODS.subscribeProjectClones]: AuthOrchestrationReadScope,
  [WS_METHODS.projectsListEntries]: AuthFilesystemReadScope,
  [WS_METHODS.projectsListIgnoredFiles]: AuthFilesystemReadScope,
  [WS_METHODS.projectsReadFile]: AuthFilesystemReadScope,
  [WS_METHODS.projectsSearchContents]: AuthFilesystemReadScope,
  [WS_METHODS.projectsSearchEntries]: AuthFilesystemReadScope,
  [WS_METHODS.projectsWriteFile]: AuthFilesystemWriteScope,
  [WS_METHODS.projectsEnsureScratch]: AuthOrchestrationOperateScope,
  [WS_METHODS.projectsCreateNew]: AuthOrchestrationOperateScope,
  [WS_METHODS.shellOpenInEditor]: AuthOrchestrationOperateScope,
  [WS_METHODS.filesystemBrowse]: AuthFilesystemReadScope,
  [WS_METHODS.filesystemGetMetadata]: AuthFilesystemReadScope,
  [WS_METHODS.agentSessionsScan]: AuthOrchestrationReadScope,
  [WS_METHODS.agentSessionsImport]: AuthOrchestrationOperateScope,
  [WS_METHODS.assetsCreateUrl]: AuthOrchestrationReadScope,
  [WS_METHODS.assetsPersistChatAttachments]: AuthOrchestrationOperateScope,
  [WS_METHODS.attachmentsCreateUploadUrl]: AuthOrchestrationOperateScope,
  [WS_METHODS.attachmentsDelete]: AuthOrchestrationOperateScope,
  [WS_METHODS.providerUploadFeedback]: AuthOrchestrationOperateScope,
  [WS_METHODS.mcpAppsCallTool]: AuthOrchestrationOperateScope,
  [WS_METHODS.mcpAppsToolInfo]: AuthOrchestrationReadScope,
  [WS_METHODS.mcpAppsReadResource]: AuthOrchestrationReadScope,
  [WS_METHODS.mcpAppsUpdateModelContext]: AuthOrchestrationOperateScope,
  [WS_METHODS.subscribeVcsStatus]: AuthOrchestrationReadScope,
  [WS_METHODS.subscribeWorktreeSetup]: AuthOrchestrationReadScope,
  [WS_METHODS.worktreeSetupCancel]: AuthOrchestrationOperateScope,
  [WS_METHODS.subscribeResourceTelemetry]: AuthDiagnosticsReadScope,
  [WS_METHODS.vcsRefreshStatus]: AuthOrchestrationReadScope,
  [WS_METHODS.gitResolvePullRequest]: AuthOrchestrationReadScope,
  [WS_METHODS.vcsListRefs]: AuthOrchestrationReadScope,
  [WS_METHODS.reviewGetBranchCommits]: AuthFilesystemReadScope,
  [WS_METHODS.reviewGetDiffPreview]: AuthFilesystemReadScope,
  [WS_METHODS.reviewGetDiffFileContents]: AuthFilesystemReadScope,
  [WS_METHODS.terminalOpen]: AuthTerminalOperateScope,
  [WS_METHODS.terminalAttach]: AuthTerminalOperateScope,
  [WS_METHODS.terminalObserve]: AuthTerminalReadScope,
  [WS_METHODS.terminalWrite]: AuthTerminalOperateScope,
  [WS_METHODS.terminalResize]: AuthTerminalOperateScope,
  [WS_METHODS.terminalClear]: AuthTerminalOperateScope,
  [WS_METHODS.terminalClose]: AuthTerminalOperateScope,
  [WS_METHODS.subscribeTerminalMetadata]: AuthTerminalReadScope,
  [WS_METHODS.previewOpen]: AuthPreviewOperateScope,
  [WS_METHODS.previewResize]: AuthPreviewOperateScope,
  [WS_METHODS.previewAdjust]: AuthPreviewOperateScope,
  [WS_METHODS.previewClose]: AuthPreviewOperateScope,
  [WS_METHODS.previewList]: AuthOrchestrationReadScope,
  [WS_METHODS.previewClearProfile]: AuthPreviewOperateScope,
  [WS_METHODS.previewReportProfiles]: AuthPreviewOperateScope,
  [WS_METHODS.previewReportStatus]: AuthPreviewOperateScope,
  [WS_METHODS.previewStopLocalServer]: AuthTerminalOperateScope,
  [WS_METHODS.subscribePreviewEvents]: AuthOrchestrationReadScope,
  [WS_METHODS.subscribeDiscoveredLocalServers]: AuthOrchestrationReadScope,
  [WS_METHODS.deviceConfigure]: AuthSettingsWriteScope,
  [WS_METHODS.deviceTestHost]: AuthSettingsWriteScope,
  [WS_METHODS.deviceEasAccount]: AuthSettingsWriteScope,
  [WS_METHODS.deviceSimlockIdentity]: AuthSettingsWriteScope,
  [WS_METHODS.deviceList]: AuthOrchestrationReadScope,
  [WS_METHODS.deviceOpen]: AuthOrchestrationOperateScope,
  [WS_METHODS.deviceClose]: AuthOrchestrationOperateScope,
  [WS_METHODS.deviceShutdown]: AuthOrchestrationOperateScope,
  [WS_METHODS.deviceDetail]: AuthOrchestrationReadScope,
  [WS_METHODS.deviceAction]: AuthOrchestrationOperateScope,
  [WS_METHODS.subscribeDeviceState]: AuthOrchestrationReadScope,
  [WS_METHODS.subscribeServerConfig]: AuthOrchestrationReadScope,
  [WS_METHODS.subscribeServerLifecycle]: AuthOrchestrationReadScope,
  [WS_METHODS.subscribeAuthAccess]: AuthAccessReadScope,
  [WS_METHODS.membersSubscribe]: AuthAccessReadScope,
  // A member's own way out; member policy is what lets them reach it.
  [WS_METHODS.membersLeave]: AuthOrchestrationReadScope,
  // A paired phone registers itself; keys are scoped to the caller's own audience.
  [WS_METHODS.notificationsRegisterDeviceKey]: AuthOrchestrationReadScope,
  [WS_METHODS.notificationsRemoveDeviceKey]: AuthOrchestrationReadScope,
  // Reading and leaving rooms, and muting one, are the caller's own; the service fences rooms.
  [WS_METHODS.roomsSubscribe]: AuthOrchestrationReadScope,
  [WS_METHODS.roomsHistory]: AuthOrchestrationReadScope,
  [WS_METHODS.roomsSubscribeFeed]: AuthOrchestrationReadScope,
  [WS_METHODS.roomsLeave]: AuthOrchestrationReadScope,
  [WS_METHODS.roomsSetMuted]: AuthOrchestrationReadScope,
  [WS_METHODS.roomsMarkRead]: AuthOrchestrationReadScope,
  // Each viewer's own sidebar layout.
  [WS_METHODS.sidebarLayoutSubscribe]: AuthOrchestrationReadScope,
  [WS_METHODS.sidebarLayoutSet]: AuthOrchestrationReadScope,
} as const satisfies Readonly<Record<WsRpcMethod, AuthEnvironmentScope>>;

/**
 * What an invited member's session may call, decided per method so a new RPC does not compile
 * until someone decides. Allowed methods are filtered or checked further in their handlers:
 * shell and search show only her threads in bots shared with her, thread reads and writes need
 * her own thread, and `dispatchCommand` goes through `authorizeMemberCommand`.
 */
const MEMBER_RPC_POLICY = {
  // Her conversations: filtered to her threads, or checked to be hers.
  [ORCHESTRATION_V2_WS_METHODS.subscribeShell]: "allow",
  [ORCHESTRATION_V2_WS_METHODS.getArchivedShellSnapshot]: "allow",
  [ORCHESTRATION_V2_WS_METHODS.getOlderSettledThreads]: "allow",
  [ORCHESTRATION_V2_WS_METHODS.getThreadFamily]: "allow",
  [ORCHESTRATION_V2_WS_METHODS.searchThreads]: "allow",
  [ORCHESTRATION_V2_WS_METHODS.searchThread]: "allow",
  [ORCHESTRATION_V2_WS_METHODS.searchThreadStream]: "allow",
  [ORCHESTRATION_V2_WS_METHODS.subscribeThread]: "allow",
  [ORCHESTRATION_V2_WS_METHODS.getThreadProjection]: "allow",
  [ORCHESTRATION_V2_WS_METHODS.getTurnItem]: "allow",
  [ORCHESTRATION_V2_WS_METHODS.getTurnDiff]: "allow",
  [ORCHESTRATION_V2_WS_METHODS.getFullThreadDiff]: "allow",
  [ORCHESTRATION_V2_WS_METHODS.subscribeCommandOutput]: "allow",
  [ORCHESTRATION_V2_WS_METHODS.dispatchCommand]: "allow",
  [ORCHESTRATION_V2_WS_METHODS.launchThread]: "allow",
  // Attachments she sends; assets only for resources that are not files on the host.
  [WS_METHODS.attachmentsCreateUploadUrl]: "allow",
  [WS_METHODS.attachmentsDelete]: "allow",
  [WS_METHODS.assetsPersistChatAttachments]: "allow",
  [WS_METHODS.assetsCreateUrl]: "allow",
  // What the chat UI needs to connect; the config is redacted for her.
  [WS_METHODS.serverProbe]: "allow",
  [WS_METHODS.serverGetConfig]: "allow",
  [WS_METHODS.subscribeServerConfig]: "allow",
  [WS_METHODS.subscribeServerLifecycle]: "allow",
  [WS_METHODS.serverReportClientActivity]: "allow",
  [WS_METHODS.membersLeave]: "allow",
  // Her own phones, filed under her audience.
  [WS_METHODS.notificationsRegisterDeviceKey]: "allow",
  [WS_METHODS.notificationsRemoveDeviceKey]: "allow",
  // The Rooms service decides per room: only rooms she is in, and creating needs the owner's leave.
  [WS_METHODS.roomsSubscribe]: "allow",
  [WS_METHODS.roomsCreate]: "allow",
  [WS_METHODS.roomsRename]: "allow",
  [WS_METHODS.roomsAddParticipant]: "allow",
  [WS_METHODS.roomsRemoveParticipant]: "allow",
  [WS_METHODS.roomsLeave]: "allow",
  [WS_METHODS.roomsSetArchived]: "allow",
  [WS_METHODS.roomsSetMuted]: "allow",
  [WS_METHODS.roomsDelete]: "allow",
  [WS_METHODS.roomsPost]: "allow",
  [WS_METHODS.roomsHistory]: "allow",
  [WS_METHODS.roomsSubscribeFeed]: "allow",
  [WS_METHODS.roomsRespond]: "allow",
  [WS_METHODS.roomsMarkRead]: "allow",
  // Her own sidebar layout, stored under her member id.
  [WS_METHODS.sidebarLayoutSubscribe]: "allow",
  [WS_METHODS.sidebarLayoutSet]: "allow",
  [WS_METHODS.previewClose]: "deny",
  [WS_METHODS.previewStopLocalServer]: "deny",
  [WS_METHODS.serverRunStorageCleanup]: "deny",
  [WS_METHODS.serverCheckOtlpEndpoint]: "deny",
  [WS_METHODS.serverRefreshProviders]: "deny",
  [WS_METHODS.pullRequestsRunAction]: "deny",
  [WS_METHODS.pullRequestsUpdate]: "deny",
  [WS_METHODS.pullRequestsComment]: "deny",
  [WS_METHODS.pullRequestsUpdateComment]: "deny",
  [WS_METHODS.pullRequestsSubmitReview]: "deny",
  [WS_METHODS.pullRequestsReplyToThread]: "deny",
  [WS_METHODS.pullRequestsSetThreadResolution]: "deny",
  [WS_METHODS.pullRequestsSetReaction]: "deny",
  [WS_METHODS.pullRequestsSetFilesViewed]: "deny",
  [WS_METHODS.pullRequestsRequestReviewers]: "deny",
  [WS_METHODS.pullRequestsSetLabels]: "deny",
  [WS_METHODS.pullRequestsGenerateReviewGuide]: "deny",
  [WS_METHODS.projectsCreateFromThread]: "deny",
  [WS_METHODS.botsCreate]: "deny",
  [WS_METHODS.botsArchive]: "deny",
  [WS_METHODS.botsUnarchive]: "deny",
  [WS_METHODS.botsDelete]: "deny",
  // A call's voice reads the bot's persona, notes and conversation, which stay the owner's.
  [WS_METHODS.botsCallStart]: "deny",
  [WS_METHODS.botsCallEnd]: "deny",
  [WS_METHODS.membersInvite]: "deny",
  [WS_METHODS.membersUpdate]: "deny",
  [WS_METHODS.membersRemove]: "deny",
  [WS_METHODS.membersSetBotAccess]: "deny",
  [WS_METHODS.membersSetBotConnectionAccess]: "deny",
  [WS_METHODS.sourceControlCloneRepository]: "deny",
  [WS_METHODS.sourceControlPublishRepository]: "deny",
  [WS_METHODS.sourceControlStar]: "deny",
  [WS_METHODS.sourceControlSignInStart]: "deny",
  [WS_METHODS.sourceControlSignInWait]: "deny",
  [WS_METHODS.sourceControlSignInCancel]: "deny",
  [WS_METHODS.projectCloneStart]: "deny",
  [WS_METHODS.projectCloneCancel]: "deny",
  [WS_METHODS.projectCloneRetry]: "deny",
  [WS_METHODS.vcsPull]: "deny",
  [WS_METHODS.gitRunStackedAction]: "deny",
  [WS_METHODS.gitPreparePullRequestThread]: "deny",
  [WS_METHODS.vcsCreateWorktree]: "deny",
  [WS_METHODS.vcsRemoveWorktree]: "deny",
  [WS_METHODS.vcsCreateRef]: "deny",
  [WS_METHODS.vcsSwitchRef]: "deny",
  [WS_METHODS.vcsInit]: "deny",
  [WS_METHODS.serverPrepareTriage]: "deny",
  [WS_METHODS.scheduledTasksUpsert]: "deny",
  [WS_METHODS.scheduledTasksSetEnabled]: "deny",
  [WS_METHODS.scheduledTasksDelete]: "deny",
  [WS_METHODS.scheduledTasksRunNow]: "deny",
  [WS_METHODS.scheduledTasksRotateWebhookToken]: "deny",
  [ORCHESTRATION_V2_WS_METHODS.stopWorkflow]: "deny",
  [ORCHESTRATION_V2_WS_METHODS.forceStopThread]: "deny",
  [WS_METHODS.guestShareCreate]: "deny",
  [WS_METHODS.peerLinksLink]: "deny",
  [WS_METHODS.peerLinksUnlink]: "deny",
  [WS_METHODS.peerLinksAnswerRequest]: "deny",
  [WS_METHODS.connectorsStartOAuth]: "deny",
  [WS_METHODS.connectorsAddConnection]: "deny",
  [WS_METHODS.connectorsRename]: "deny",
  [WS_METHODS.connectorsReauthenticate]: "deny",
  [WS_METHODS.connectorsDisconnect]: "deny",
  [WS_METHODS.connectorsRemove]: "deny",
  [WS_METHODS.connectorsTest]: "deny",
  [WS_METHODS.connectorsSetBotConnection]: "deny",
  [WS_METHODS.secretVaultsSubscribe]: "deny",
  [WS_METHODS.secretVaultsCreate]: "deny",
  [WS_METHODS.secretVaultsRename]: "deny",
  [WS_METHODS.secretVaultsRemove]: "deny",
  [WS_METHODS.secretVaultsSetBot]: "deny",
  [WS_METHODS.secretVaultsPutEntry]: "deny",
  [WS_METHODS.secretVaultsRemoveEntry]: "deny",
  [WS_METHODS.connectorsAnswerRequest]: "deny",
  [WS_METHODS.connectorsDetectAuth]: "deny",
  [ORCHESTRATION_V2_WS_METHODS.getWorkflowScript]: "deny",
  [ORCHESTRATION_V2_WS_METHODS.getNativeChildWork]: "deny",
  [ORCHESTRATION_V2_WS_METHODS.getWorktreeThreadIds]: "deny",
  [WS_METHODS.projectsMutate]: "deny",
  [WS_METHODS.serverGetNpmRelease]: "deny",
  [WS_METHODS.serverUpdateProvider]: "deny",
  [WS_METHODS.providerAuthStart]: "deny",
  [WS_METHODS.providerConsumeResetCredit]: "deny",
  [WS_METHODS.providerAuthComplete]: "deny",
  [WS_METHODS.chatGptReconnectProfile]: "deny",
  [WS_METHODS.chatGptImportProfile]: "deny",
  [WS_METHODS.chatGptHandoffSubscribe]: "deny",
  [WS_METHODS.providerAuthRespond]: "deny",
  [WS_METHODS.providerAuthCancel]: "deny",
  [WS_METHODS.providerAuthLogout]: "deny",
  [WS_METHODS.providerAuthSubscribe]: "deny",
  [WS_METHODS.providerInstallStart]: "deny",
  [WS_METHODS.providerInstallCancel]: "deny",
  [WS_METHODS.providerInstallSubscribe]: "deny",
  [WS_METHODS.providerInstallRemove]: "deny",
  [WS_METHODS.serverUpdateServer]: "deny",
  [WS_METHODS.serverUpdateServerWithProgress]: "deny",
  [WS_METHODS.serverCommitDesktopUpdate]: "deny",
  [WS_METHODS.serverUpsertKeybinding]: "deny",
  [WS_METHODS.serverRemoveKeybinding]: "deny",
  [WS_METHODS.serverGetStorageCleanupReport]: "deny",
  [WS_METHODS.serverGetDatabaseStorage]: "deny",
  [WS_METHODS.peerLinksList]: "deny",
  [WS_METHODS.connectorsListCatalog]: "deny",
  [WS_METHODS.connectorsList]: "deny",
  [WS_METHODS.connectorsSubscribe]: "deny",
  [WS_METHODS.serverUpdateSettings]: "deny",
  [WS_METHODS.serverSearchAcpRegistry]: "deny",
  [WS_METHODS.serverPrepareAcpRegistryAgent]: "deny",
  [WS_METHODS.serverUninstallAcpRegistryManagedBinary]: "deny",
  [WS_METHODS.serverAcceptAcpRegistryUrlAuth]: "deny",
  [WS_METHODS.serverListAcpRegistrySessions]: "deny",
  [WS_METHODS.serverImportAcpRegistrySession]: "deny",
  [WS_METHODS.serverDeleteAcpRegistrySession]: "deny",
  [WS_METHODS.serverListAcpRegistryProviders]: "deny",
  [WS_METHODS.serverSetAcpRegistryProvider]: "deny",
  [WS_METHODS.serverDisableAcpRegistryProvider]: "deny",
  [WS_METHODS.serverLogoutAcpRegistry]: "deny",
  [WS_METHODS.serverDiscoverSourceControl]: "deny",
  [WS_METHODS.serverGetTraceDiagnostics]: "deny",
  [WS_METHODS.serverGetProcessDiagnostics]: "deny",
  [WS_METHODS.serverGetHostResources]: "deny",
  [WS_METHODS.serverGetProcessResourceHistory]: "deny",
  [WS_METHODS.serverGetResourceTelemetryHistory]: "deny",
  [WS_METHODS.serverRetryResourceTelemetry]: "deny",
  [WS_METHODS.serverGetUsageSummary]: "deny",
  [WS_METHODS.serverRefreshUsageRates]: "deny",
  [WS_METHODS.serverSignalProcess]: "deny",
  [WS_METHODS.scheduledTasksSubscribe]: "deny",
  [WS_METHODS.secretsAnswerRequest]: "deny",
  [WS_METHODS.scheduledTasksListWebhookDeliveries]: "deny",
  [WS_METHODS.scheduledTasksGetWebhookDelivery]: "deny",
  [WS_METHODS.cloudGetRelayClientStatus]: "deny",
  [WS_METHODS.cloudInstallRelayClient]: "deny",
  [WS_METHODS.pullRequestsList]: "deny",
  [WS_METHODS.pullRequestsListStats]: "deny",
  [WS_METHODS.pullRequestsFilterOptions]: "deny",
  [WS_METHODS.pullRequestsSummary]: "deny",
  [WS_METHODS.pullRequestsRouting]: "deny",
  [WS_METHODS.pullRequestsRoutingIdentity]: "deny",
  [WS_METHODS.pullRequestsStack]: "deny",
  [WS_METHODS.pullRequestsLinkedThreads]: "deny",
  [WS_METHODS.pullRequestsDetail]: "deny",
  [WS_METHODS.pullRequestsPreview]: "deny",
  [WS_METHODS.pullRequestsChecks]: "deny",
  [WS_METHODS.pullRequestsActivity]: "deny",
  [WS_METHODS.pullRequestsReviewGuide]: "deny",
  [WS_METHODS.pullRequestsThreadComments]: "deny",
  [WS_METHODS.pullRequestsDiffFileContents]: "deny",
  [WS_METHODS.pullRequestsFilesViewed]: "deny",
  [WS_METHODS.pullRequestsChangeBreakdown]: "deny",
  [WS_METHODS.pullRequestsInvalidate]: "deny",
  [WS_METHODS.pullRequestsReportState]: "deny",
  [WS_METHODS.pullRequestsSubscribeRefreshes]: "deny",
  [WS_METHODS.pullRequestsReviewerCandidates]: "deny",
  [WS_METHODS.pullRequestsLabelCandidates]: "deny",
  [WS_METHODS.sourceControlLookupRepository]: "deny",
  [WS_METHODS.sourceControlAppAccess]: "deny",
  [WS_METHODS.sourceControlStarred]: "deny",
  [WS_METHODS.subscribeProjectClones]: "deny",
  [WS_METHODS.projectsListEntries]: "deny",
  [WS_METHODS.projectsListIgnoredFiles]: "deny",
  [WS_METHODS.projectsReadFile]: "deny",
  [WS_METHODS.projectsSearchContents]: "deny",
  [WS_METHODS.projectsSearchEntries]: "deny",
  [WS_METHODS.projectsWriteFile]: "deny",
  [WS_METHODS.projectsEnsureScratch]: "deny",
  [WS_METHODS.projectsCreateNew]: "deny",
  [WS_METHODS.shellOpenInEditor]: "deny",
  [WS_METHODS.filesystemBrowse]: "deny",
  [WS_METHODS.filesystemGetMetadata]: "deny",
  [WS_METHODS.agentSessionsScan]: "deny",
  [WS_METHODS.agentSessionsImport]: "deny",
  [WS_METHODS.providerUploadFeedback]: "deny",
  [WS_METHODS.mcpAppsCallTool]: "deny",
  [WS_METHODS.mcpAppsToolInfo]: "deny",
  [WS_METHODS.mcpAppsReadResource]: "deny",
  [WS_METHODS.mcpAppsUpdateModelContext]: "deny",
  [WS_METHODS.subscribeVcsStatus]: "deny",
  [WS_METHODS.subscribeWorktreeSetup]: "deny",
  [WS_METHODS.worktreeSetupCancel]: "deny",
  [WS_METHODS.subscribeResourceTelemetry]: "deny",
  [WS_METHODS.vcsRefreshStatus]: "deny",
  [WS_METHODS.gitResolvePullRequest]: "deny",
  [WS_METHODS.vcsListRefs]: "deny",
  [WS_METHODS.reviewGetBranchCommits]: "deny",
  [WS_METHODS.reviewGetDiffPreview]: "deny",
  [WS_METHODS.reviewGetDiffFileContents]: "deny",
  [WS_METHODS.terminalOpen]: "deny",
  [WS_METHODS.terminalAttach]: "deny",
  [WS_METHODS.terminalObserve]: "deny",
  [WS_METHODS.terminalWrite]: "deny",
  [WS_METHODS.terminalResize]: "deny",
  [WS_METHODS.terminalClear]: "deny",
  [WS_METHODS.terminalClose]: "deny",
  [WS_METHODS.subscribeTerminalMetadata]: "deny",
  [WS_METHODS.previewOpen]: "deny",
  [WS_METHODS.previewResize]: "deny",
  [WS_METHODS.previewAdjust]: "deny",
  [WS_METHODS.previewList]: "deny",
  [WS_METHODS.previewClearProfile]: "deny",
  [WS_METHODS.previewReportProfiles]: "deny",
  [WS_METHODS.previewReportStatus]: "deny",
  [WS_METHODS.subscribePreviewEvents]: "deny",
  [WS_METHODS.subscribeDiscoveredLocalServers]: "deny",
  [WS_METHODS.deviceConfigure]: "deny",
  [WS_METHODS.deviceTestHost]: "deny",
  [WS_METHODS.deviceEasAccount]: "deny",
  [WS_METHODS.deviceSimlockIdentity]: "deny",
  [WS_METHODS.deviceList]: "deny",
  [WS_METHODS.deviceOpen]: "deny",
  [WS_METHODS.deviceClose]: "deny",
  [WS_METHODS.deviceShutdown]: "deny",
  [WS_METHODS.deviceDetail]: "deny",
  [WS_METHODS.deviceAction]: "deny",
  [WS_METHODS.subscribeDeviceState]: "deny",
  [WS_METHODS.subscribeAuthAccess]: "deny",
  [WS_METHODS.membersSubscribe]: "deny",
} as const satisfies Readonly<Record<WsRpcMethod, "allow" | "deny">>;

export function requiredScopeForRpcMethod(method: string): AuthEnvironmentScope {
  if (!Object.hasOwn(RPC_REQUIRED_SCOPES, method)) {
    throw new Error(`RPC method ${method} has no declared authorization scope.`);
  }
  const requiredScope = RPC_REQUIRED_SCOPES[method as WsRpcMethod];
  if (requiredScope === undefined) {
    throw new Error(`RPC method ${method} has no declared authorization scope.`);
  }
  return requiredScope;
}

export const rpcAuthorizationError = (requiredScope: AuthEnvironmentScope) =>
  new EnvironmentAuthorizationError({
    message: `The authenticated token is missing required scope: ${requiredScope}.`,
    ...authScopeRequiredResponse(requiredScope),
  });

const SettingsUpdate = Schema.Struct({
  patch: ServerSettingsPatch,
  providerInstanceMutation: Schema.optionalKey(ProviderInstanceMutation),
});
// Middleware receives the payload already decoded, so it is checked against the decoded shape.
const decodeSettingsUpdate = Schema.decodeUnknownSync(Schema.toType(SettingsUpdate));

const requiredScopesForSettingsUpdate = (payload: unknown) => {
  const input = decodeSettingsUpdate(payload);
  const scopes = requiredScopesForServerSettingsPatch(input.patch);
  if (input.providerInstanceMutation === undefined) return scopes;
  return Object.values(input.patch).every((value) => value === undefined)
    ? [AuthProvidersManageScope]
    : [...new Set([...scopes, AuthProvidersManageScope])];
};

const decodeProjectMutation = Schema.decodeUnknownSync(ProjectMutation);
const decodeAssetCreateUrlInput = Schema.decodeUnknownSync(AssetCreateUrlInput);

/** Assets that are not files on the host: what a member's chat shows. */
const MEMBER_ASSET_RESOURCES: ReadonlySet<AssetCreateUrlInput["resource"]["_tag"]> = new Set([
  "attachment",
  "tool-output-image",
  "native-app-icon",
]);

const isMemberRpcCallAllowed = (method: string, payload: unknown) => {
  if (!Object.hasOwn(MEMBER_RPC_POLICY, method)) return false;
  if (MEMBER_RPC_POLICY[method as WsRpcMethod] !== "allow") return false;
  return method === WS_METHODS.assetsCreateUrl
    ? MEMBER_ASSET_RESOURCES.has(decodeAssetCreateUrlInput(payload).resource._tag)
    : true;
};

const requiredScopesForRpcCall = (
  method: string,
  payload: unknown,
): ReadonlyArray<AuthEnvironmentScope> => {
  if (method === WS_METHODS.serverRetryResourceTelemetry) {
    return [AuthEnvironmentMaintainScope, AuthDiagnosticsReadScope];
  }
  if (method === WS_METHODS.assetsCreateUrl) {
    const { resource } = decodeAssetCreateUrlInput(payload);
    return [
      resource._tag === "workspace-file" ||
      resource._tag === "media-file" ||
      resource._tag === "draft-workspace-file"
        ? AuthFilesystemReadScope
        : AuthOrchestrationReadScope,
    ];
  }
  if (method === WS_METHODS.serverUpdateSettings) return requiredScopesForSettingsUpdate(payload);
  if (method === WS_METHODS.projectsMutate) {
    return requiredScopesForProjectMutation(decodeProjectMutation(payload));
  }
  const guarded = clientRpcRequiredScopes(method, payload);
  if (guarded.length > 0) return guarded;
  return [requiredScopeForRpcMethod(method)];
};

/**
 * `onAuthorized` runs once after an authorized request succeeds; for a stream
 * RPC, that is when the stream completes. Every RPC passes through here, so it
 * is the one place to observe requests without wrapping each handler.
 */
export const layer = (
  scopes: ReadonlyArray<AuthEnvironmentScope>,
  onAuthorized?: (method: string, payload: unknown) => Effect.Effect<void>,
  memberId?: EnvironmentMemberId,
) =>
  Layer.succeed(RpcScopeAuthorization)((effect, { rpc, payload }) => {
    const requiredScopes = requiredScopesForRpcCall(rpc._tag, payload);
    const requiredScope = requiredScopes.find((scope) => !scopes.includes(scope));
    if (requiredScope !== undefined) return Effect.fail(rpcAuthorizationError(requiredScope));
    if (memberId !== undefined && !isMemberRpcCallAllowed(rpc._tag, payload)) {
      return Effect.fail(memberDenied(requiredScopes[0]));
    }
    return onAuthorized === undefined
      ? effect
      : Effect.tap(effect, () => onAuthorized(rpc._tag, payload));
  });

/** Retrying can install or restart tools even though ordinary listing is readable. */
export const requiredScopeForDeviceList = (input: DeviceListInput): AuthEnvironmentScope =>
  input.retryHostId || input.updateTool
    ? AuthOrchestrationOperateScope
    : AuthOrchestrationReadScope;
