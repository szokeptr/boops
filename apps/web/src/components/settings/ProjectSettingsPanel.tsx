import { useComposerMenuState } from "../chat/useComposerMenuState";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import { useEnvironmentsWithScope } from "../../state/session";
import { mapAtomCommandResult, settlePromise } from "@t3tools/client-runtime/state/runtime";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { botHomeFolderUnavailableReason } from "@t3tools/client-runtime/state/bot-home-folder";
import { planProjectRemoval } from "@t3tools/client-runtime/state/projects";
import { type EnvironmentId } from "@t3tools/contracts";
import {
  checkProjectAccess,
  reportProjectFailure,
  useProjectGroupUpdate,
  type ProjectGroupUpdate,
} from "../../hooks/useProjectGroupUpdate";
import { Navigate, useLocation, useNavigate } from "@tanstack/react-router";
import { InfoIcon, Trash2Icon } from "lucide-react";
import { lazy, Suspense, useRef, useState, type ReactNode } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { releaseProjectDraftUploads } from "../../lib/composerDraftUploads";
import { readLocalApi } from "../../localApi";
import {
  type SidebarProjectGroupMember,
  type SidebarProjectSnapshot,
} from "../../sidebarProjectGrouping";
import {
  useEnvironmentProviders,
  useEnvironments,
  usePrimaryEnvironmentId,
} from "../../state/environments";
import { useThreadShells, waitForProjectRemoval } from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
import { ProjectFavicon } from "../ProjectFavicon";
import { openDeleteBotDialog, useBotArchive } from "../bots/BotLifecycle";
import { BotConnectorsSection } from "../connectors/BotConnectorsSection";
import { BotVaultsSection } from "../vaults/BotVaultsSection";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import {
  canPickExternalProjectFavicon,
  ProjectFaviconPickerDialog,
} from "./ProjectFaviconPickerDialog";
import { BotCallVoiceRows } from "./BotCallVoiceRows";
import { ProjectDefaultsSettings } from "./ProjectDefaultsSettings";
import {
  defaultProjectIcon,
  hasDefaultProjectIcon,
  projectGroupTitleNeedsUpdate,
  SCRATCH_PROJECT_TITLE,
} from "./ProjectSettingsPanel.logic";
import { useSettingsProjectGroups } from "./useSettingsProjectGroups";
import { readUnloadedThreadCount } from "../../state/olderSettledShelf";

const ProjectIconPickerDialog = lazy(() =>
  import("./ProjectIconPickerDialog").then((module) => ({
    default: module.ProjectIconPickerDialog,
  })),
);

export type ProjectSettingsCategory = "general" | "source-control" | "project";

interface ProjectSelection {
  readonly key: string;
  readonly environmentId: EnvironmentId | null;
  readonly checkoutKey: string | null;
  readonly memberKeys: ReadonlyArray<string>;
}

function sameProjectSelection(a: ProjectSelection | null, b: ProjectSelection): boolean {
  return (
    a !== null &&
    a.key === b.key &&
    a.environmentId === b.environmentId &&
    a.checkoutKey === b.checkoutKey &&
    a.memberKeys.length === b.memberKeys.length &&
    a.memberKeys.every((key, index) => key === b.memberKeys[index])
  );
}

export function ProjectSettingsPanel({
  projectKey,
  environmentId = null,
  checkoutKey = null,
  unavailable,
}: {
  projectKey: string;
  environmentId?: EnvironmentId | null;
  checkoutKey?: string | null;
  unavailable?: ReactNode;
}) {
  const groups = useSettingsProjectGroups();
  const pathname = useLocation({ select: (location) => location.pathname });

  const selected = groups.find((group) => group.projectKey === projectKey) ?? null;
  const members =
    selected?.memberProjects.filter(
      (member) =>
        (environmentId === null || member.environmentId === environmentId) &&
        (checkoutKey === null || member.physicalProjectKey === checkoutKey),
    ) ?? [];

  // Retain group members so grouping-rule changes can follow the project to its new group.
  const [lastSelection, setLastSelection] = useState<ProjectSelection | null>(null);
  if (selected && members.length > 0) {
    const current: ProjectSelection = {
      key: selected.projectKey,
      environmentId,
      checkoutKey,
      memberKeys: members.map((member) => member.physicalProjectKey),
    };
    if (!sameProjectSelection(lastSelection, current)) setLastSelection(current);
  }

  const successor =
    members.length === 0 &&
    lastSelection?.key === projectKey &&
    lastSelection.environmentId === environmentId &&
    lastSelection.checkoutKey === checkoutKey
      ? groups.find((group) =>
          group.memberProjects.some((member) =>
            lastSelection.memberKeys.includes(member.physicalProjectKey),
          ),
        )
      : undefined;
  if (successor) {
    return (
      <Navigate
        to={pathname}
        search={{
          project: successor.projectKey,
          machine: environmentId ?? undefined,
          checkout: checkoutKey ?? undefined,
        }}
        replace
        hashScrollIntoView={false}
      />
    );
  }

  if ((!selected || members.length === 0) && unavailable != null) return unavailable;

  if (!selected) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
        {groups.length === 0
          ? "Add a project from the sidebar to configure it here."
          : "This project is no longer available."}
      </div>
    );
  }
  if (members.length === 0)
    return (
      <p className="p-8 text-sm text-muted-foreground">
        This checkout is no longer available in the selected project and environment.
      </p>
    );
  const scopedGroup = {
    ...selected,
    memberProjects: members,
    environmentId: members[0]!.environmentId,
    id: members[0]!.id,
  };
  return (
    <ProjectDetail
      key={`${selected.projectKey}:${environmentId ?? "all"}:${checkoutKey ?? "all"}`}
      group={scopedGroup}
      allMembers={selected.memberProjects}
      hasOtherMembers={members.length < selected.memberProjects.length}
    />
  );
}

function ProjectDetail({
  group,
  allMembers,
  hasOtherMembers,
}: {
  group: SidebarProjectSnapshot;
  /** Archive belongs to the whole bot, even when one machine is picked. */
  allMembers: ReadonlyArray<SidebarProjectGroupMember>;
  hasOtherMembers: boolean;
}) {
  const navigate = useNavigate({ from: "/settings" });
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  const environmentById = new Map(
    environments.map((environment) => [environment.environmentId, environment]),
  );
  const editableIds = useEnvironmentsWithScope(allMembers, AuthOrchestrationOperateScope);
  const canEditGroup = group.memberProjects.every((member) =>
    editableIds.has(member.environmentId),
  );
  const representative =
    group.memberProjects.find(
      (member) => environmentById.get(member.environmentId)?.serverConfig != null,
    ) ?? group.memberProjects[0]!;
  const threads = useThreadShells();
  const homeFolderUnavailableReason = botHomeFolderUnavailableReason(
    group.memberProjects,
    threads,
    useEnvironmentProviders(),
  );
  const deleteProject = useOrchestrationCommand(projectEnvironment.delete, {
    reportFailure: false,
  });
  const projectNameEditedRef = useRef(false);

  const faviconPath = representative.faviconPath ?? null;
  const projectIcon = representative.projectIcon ?? null;
  const pickProjectFavicon =
    typeof window !== "undefined" &&
    group.memberProjects.every(
      (member) =>
        member.environmentId === primaryEnvironmentId &&
        canPickExternalProjectFavicon(member.workspaceRoot, navigator.platform),
    )
      ? window.desktopBridge?.pickProjectFavicon
      : undefined;

  const { updateProjectGroup, canOrganizeProjectGroup } = useProjectGroupUpdate();
  const updateAllMembers = (
    input: ProjectGroupUpdate | ((member: SidebarProjectGroupMember) => ProjectGroupUpdate),
    failureTitle: string,
  ) => updateProjectGroup(group.memberProjects, input, failureTitle);
  const canOrganize =
    allMembers.every((member) => editableIds.has(member.environmentId)) &&
    canOrganizeProjectGroup(allMembers);
  const [isOrganizing, setIsOrganizing] = useState(false);

  const { archiveBot, unarchiveBot } = useBotArchive();
  const setArchived = async (archived: boolean) => {
    if (checkProjectAccess(allMembers, archived ? "Failed to archive" : "Failed to unarchive"))
      return;
    setIsOrganizing(true);
    for (const member of allMembers) {
      const bot = { environmentId: member.environmentId, projectId: member.id, name: member.title };
      await (archived ? archiveBot(bot) : unarchiveBot(bot));
    }
    setIsOrganizing(false);
  };

  const renameGroup = async (nextTitle: string, wasEdited: boolean) => {
    const title = nextTitle.trim();
    if (!title) {
      toastManager.add({ type: "warning", title: "Bot name cannot be empty" });
      return;
    }
    if (
      !projectGroupTitleNeedsUpdate(
        group.memberProjects.map((member) => member.title),
        title,
        wasEdited,
      )
    ) {
      return;
    }
    await updateAllMembers({ title }, "Failed to rename bot");
  };

  const [faviconPickerOpen, setFaviconPickerOpen] = useComposerMenuState(!canEditGroup);
  const [iconPickerOpen, setIconPickerOpen] = useComposerMenuState(!canEditGroup);
  const [isSavingFavicon, setIsSavingFavicon] = useState(false);
  const savingFaviconRef = useRef(false);
  const setProjectIcon = async (input: Parameters<typeof updateAllMembers>[0]) => {
    if (savingFaviconRef.current) return;
    savingFaviconRef.current = true;
    setIsSavingFavicon(true);
    await updateAllMembers(input, "Failed to update project icon");
    savingFaviconRef.current = false;
    setIsSavingFavicon(false);
  };

  const hasMultipleCheckouts = group.memberProjects.length > 1;
  const canResetScratchTitle =
    group.memberProjects.every((member) => member.isScratch) &&
    group.memberProjects.some((member) => member.title !== SCRATCH_PROJECT_TITLE);

  const removeMembers = async (members: ReadonlyArray<SidebarProjectGroupMember>) => {
    if (checkProjectAccess(members, "Failed to remove project")) return;
    const api = readLocalApi();
    if (!api) return;

    const { projectThreads, isWholeGroup, confirmationMessage } = planProjectRemoval({
      members,
      groupMemberCount: group.memberProjects.length,
      hasOtherMembers,
      displayName: group.displayName,
      threads,
      unloadedThreadCount: readUnloadedThreadCount(members, threads),
    });
    const confirmed = await settlePromise(() =>
      api.dialogs.confirm(confirmationMessage, { variant: "destructive" }),
    );
    if (confirmed._tag === "Failure" || !confirmed.value) return;
    if (checkProjectAccess(members, "Failed to remove project")) return;

    const draftStore = useComposerDraftStore.getState();
    for (const member of members) {
      if (checkProjectAccess([member], "Failed to remove project")) return;
      const memberThreads = projectThreads.filter(
        (thread) => thread.environmentId === member.environmentId && thread.projectId === member.id,
      );
      const result = mapAtomCommandResult(
        await deleteProject({
          environmentId: member.environmentId,
          input: {
            projectId: member.id,
            force: true,
          },
        }),
        () => undefined,
      );
      if (result._tag === "Failure") {
        reportProjectFailure(`Failed to remove "${member.title}"`, result);
        return;
      }
      const projectRef = scopeProjectRef(member.environmentId, member.id);
      await waitForProjectRemoval(projectRef);
      releaseProjectDraftUploads(
        projectRef,
        memberThreads.map((thread) => scopeThreadRef(thread.environmentId, thread.id)),
      );
      const projectDraftThread = draftStore.getDraftThreadByProjectRef(projectRef);
      if (projectDraftThread) {
        draftStore.clearDraftThread(projectDraftThread.draftId);
      }
      draftStore.clearProjectDraftThreadId(projectRef);
    }

    if (isWholeGroup && !hasOtherMembers) {
      void navigate({
        to: "/settings/projects",
        search: ({ machine }) => ({ project: undefined, machine, checkout: undefined }),
        replace: true,
      });
    }
  };

  return (
    <>
      <SettingsPageContainer className="gap-6">
        <Alert variant="info">
          <InfoIcon aria-hidden />
          <AlertDescription>
            Can't find a setting? Keep this bot picked above and hop to any other settings page.
          </AlertDescription>
        </Alert>
        <SettingsSection id="project-overview" title="Bot" hideTitle>
          {!canEditGroup ? (
            <p className="px-3 py-2 text-sm text-muted-foreground sm:px-4">
              {group.memberProjects.length > 1
                ? "Shared settings require permission to change every checkout in this group."
                : "This connection cannot change this bot."}
            </p>
          ) : null}
          <SettingsRow
            title="Name"
            description="How the bot is called in the bot list and its conversation."
            resetAction={
              canResetScratchTitle ? (
                <SettingResetButton
                  label="project name"
                  disabled={!canEditGroup}
                  onClick={() =>
                    void updateAllMembers({ title: SCRATCH_PROJECT_TITLE }, "Failed to rename bot")
                  }
                />
              ) : null
            }
            control={
              <Input
                key={`${group.projectKey}:${group.displayName}`}
                size="sm"
                className="w-full sm:w-64"
                aria-label="Bot name"
                disabled={!canEditGroup}
                defaultValue={group.displayName}
                onChange={() => {
                  projectNameEditedRef.current = true;
                }}
                onBlur={(event) => {
                  const wasEdited = projectNameEditedRef.current;
                  projectNameEditedRef.current = false;
                  void renameGroup(event.currentTarget.value, wasEdited);
                }}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
            }
          />
          <SettingsRow
            title="Project icon"
            description={
              projectIcon?.kind === "lucide"
                ? `${projectIcon.name} · ${projectIcon.color}`
                : projectIcon?.kind === "monogram"
                  ? `${projectIcon.text} · ${projectIcon.color}`
                  : projectIcon?.kind === "emoji"
                    ? projectIcon.emoji
                    : (faviconPath ?? "Automatic")
            }
            resetAction={
              group.memberProjects.some((member) => !hasDefaultProjectIcon(member)) ? (
                <SettingResetButton
                  label="project icon"
                  disabled={isSavingFavicon || !canEditGroup}
                  onClick={() => void setProjectIcon(defaultProjectIcon)}
                />
              ) : null
            }
            control={
              <div className="flex items-center gap-2">
                <ProjectFavicon project={representative} className="size-6" />
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  aria-label="Choose a project icon"
                  disabled={isSavingFavicon || !canEditGroup}
                  onClick={() => setIconPickerOpen(true)}
                >
                  Choose icon
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  aria-label="Choose a project icon file"
                  disabled={isSavingFavicon || !canEditGroup}
                  onClick={() => setFaviconPickerOpen(true)}
                >
                  Choose file
                </Button>
              </div>
            }
          />
          <SettingsRow
            title="Stay in its home folder"
            description="Limits the bot's file changes and commands to its home folder. Applies from its next session."
            status={homeFolderUnavailableReason}
            control={
              <Switch
                checked={group.memberProjects.every((member) => member.autonomy === "home-folder")}
                disabled={!canEditGroup}
                onCheckedChange={(checked) =>
                  void updateAllMembers(
                    { autonomy: checked ? "home-folder" : "full" },
                    "Failed to change where the bot can work",
                  )
                }
                aria-label="Stay in its home folder"
              />
            }
          />
          <SettingsRow
            title="Can create bots without asking"
            description="Lets this bot create new bots without showing you an approval card first."
            control={
              <Switch
                checked={group.memberProjects.every(
                  (member) => member.canCreateBotsWithoutAsking === true,
                )}
                disabled={!canEditGroup}
                onCheckedChange={(checked) =>
                  void updateAllMembers(
                    { canCreateBotsWithoutAsking: checked },
                    "Failed to change whether the bot can create bots",
                  )
                }
                aria-label="Can create bots without asking"
              />
            }
          />
          <SettingsRow
            title="Talks with any bot"
            description="Lets this bot and every other bot on this machine message each other. Without it, a bot reaches only its parent, the bots it created, and its siblings."
            control={
              <Switch
                checked={group.memberProjects.every((member) => member.talksWithAnyBot === true)}
                disabled={!canEditGroup}
                onCheckedChange={(checked) =>
                  void updateAllMembers(
                    { talksWithAnyBot: checked },
                    "Failed to change which bots this bot can talk with",
                  )
                }
                aria-label="Talks with any bot"
              />
            }
          />
          <BotCallVoiceRows
            projectId={representative.id}
            settings={representative.callSettings ?? null}
            disabled={!canEditGroup}
            onChange={(callSettings) =>
              void updateAllMembers(
                { callSettings },
                "Failed to change how the bot sounds on calls",
              )
            }
          />
          {canOrganize ? (
            <>
              <SettingsRow
                title="Archive"
                description={
                  group.archived
                    ? "Archived: its routines are paused and it is out of the bot list. Unarchiving turns back on the routines that were running."
                    : "Pauses its routines and heartbeat and moves it out of the bot list. Its conversation and home folder are kept."
                }
                control={
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isOrganizing}
                    onClick={() => void setArchived(!group.archived)}
                  >
                    {group.archived ? "Unarchive" : "Archive"}
                  </Button>
                }
              />
            </>
          ) : null}
        </SettingsSection>
        {group.memberProjects.map((member) => (
          <BotConnectorsSection
            key={`${member.environmentId}:${member.id}`}
            bot={member}
            environmentLabel={group.memberProjects.length > 1 ? member.environmentLabel : null}
          />
        ))}
        {group.memberProjects.map((member) => (
          <BotVaultsSection
            key={`${member.environmentId}:${member.id}`}
            bot={member}
            environmentLabel={group.memberProjects.length > 1 ? member.environmentLabel : null}
          />
        ))}
        <ProjectDefaultsSettings category="project" />
        <SettingsSection title="Danger">
          {!hasMultipleCheckouts && !hasOtherMembers ? (
            <SettingsRow
              title="Delete bot"
              description="Deletes its conversation, threads and routines. You choose whether its home folder goes too."
              control={
                <Button
                  size="sm"
                  variant="destructive-outline"
                  disabled={!canEditGroup}
                  onClick={() =>
                    openDeleteBotDialog({
                      environmentId: representative.environmentId,
                      projectId: representative.id,
                      name: representative.title,
                    })
                  }
                >
                  <Trash2Icon />
                  Delete bot
                </Button>
              }
            />
          ) : (
            <SettingsRow
              title={
                hasOtherMembers
                  ? "Remove checkout"
                  : group.memberProjects.length > 1
                    ? "Remove this project everywhere"
                    : "Remove project"
              }
              description={
                hasOtherMembers
                  ? "Deletes the selected machine's checkout entries and their threads. Other machines and files on disk are not touched."
                  : group.memberProjects.length > 1
                    ? `Deletes all ${group.memberProjects.length} checkout entries and their threads on every machine. Files on disk are not touched.`
                    : "Deletes the project entry and its threads. Files on disk are not touched."
              }
              control={
                <Button
                  size="sm"
                  variant="destructive-outline"
                  disabled={!canEditGroup}
                  onClick={() => void removeMembers(group.memberProjects)}
                >
                  <Trash2Icon />
                  {hasOtherMembers
                    ? "Remove checkout"
                    : group.memberProjects.length > 1
                      ? "Remove all entries"
                      : "Remove project"}
                </Button>
              }
            />
          )}
        </SettingsSection>
      </SettingsPageContainer>

      <ProjectFaviconPickerDialog
        key={`${representative.environmentId}:${representative.workspaceRoot}:${faviconPickerOpen}`}
        cwd={representative.workspaceRoot}
        environmentId={representative.environmentId}
        onOpenChange={setFaviconPickerOpen}
        {...(pickProjectFavicon
          ? { onPickExternal: () => pickProjectFavicon(representative.workspaceRoot) }
          : {})}
        onSelect={(path) => void setProjectIcon({ faviconPath: path, projectIcon: null })}
        open={faviconPickerOpen && canEditGroup}
        projectName={group.displayName}
      />
      {iconPickerOpen && canEditGroup ? (
        <Suspense fallback={null}>
          <ProjectIconPickerDialog
            current={projectIcon}
            projectName={representative.title}
            open
            onOpenChange={setIconPickerOpen}
            onSelect={(icon) => void setProjectIcon({ faviconPath: null, projectIcon: icon })}
          />
        </Suspense>
      ) : null}
    </>
  );
}
