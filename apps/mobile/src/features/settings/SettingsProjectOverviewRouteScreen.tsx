import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ProjectFavicon } from "../../components/ProjectFavicon";
import * as Dialog from "../../components/ui/Dialog";
import { AuthOrchestrationOperateScope, type BotAutonomy } from "@t3tools/contracts";
import { botHomeFolderUnavailableReason } from "@t3tools/client-runtime/state/bot-home-folder";
import { liveBotDescendants } from "@t3tools/client-runtime/state/bot-list";
import { planProjectRemoval } from "@t3tools/client-runtime/state/projects";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  deriveProjectGroupLabel,
  type ProjectGroup,
} from "@t3tools/client-runtime/state/project-grouping";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { useNavigation } from "@react-navigation/native";
import { useAtomValue } from "@effect/atom-react";
import { useRef, useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { projectEnvironment } from "../../state/projects";
import { useProjects, useThreadShells } from "../../state/entities";
import { appAtomRegistry } from "../../state/atom-registry";
import { environmentPresentations } from "../../state/presentation";
import {
  clearComposerDraft,
  composerDraftsAtom,
  findNewTaskDraftKeys,
  waitForComposerDraftsLoaded,
} from "../../state/use-composer-drafts";
import { readEnvironmentScope, useEnvironmentsWithScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { BotConnectorsSection } from "../connectors/BotConnectorsSection";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { ListActionRow as SettingsActionRow } from "../../components/ui/ListActionRow";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";
import {
  useSettingsEnvironmentMenu,
  SettingsEnvironmentFilterHeader,
} from "./components/SettingsEnvironmentFilterHeader";
import { useSettingsEnvironmentFilter, type SettingsTarget } from "./settings-environment-filter";
import { leaveSettingsPage } from "./settings-navigation";
import { workspaceHasColumns } from "../workspace/workspace-selection-store";
import { DEFAULT_SETTINGS_PAGE } from "../workspace/workspace-tab-navigation";
import { readUnloadedThreadCount } from "../../state/olderSettledShelf";

export function SettingsProjectOverviewRouteScreen() {
  const environmentMenu = useSettingsEnvironmentMenu();
  const insets = useSafeAreaInsets();
  const [isRemoving, setIsRemoving] = useState(false);
  const removalPending = useRef(false);
  const startRemoval = () => {
    if (removalPending.current) return false;
    removalPending.current = true;
    return true;
  };
  const finishRemoval = () => {
    removalPending.current = false;
    setIsRemoving(false);
  };
  const navigation = useNavigation();
  const {
    availableTargets,
    selectedTargets,
    projectGroups,
    selectedProjectKey,
    selectProject,
    getSelectedProjectKey,
  } = useSettingsEnvironmentFilter();
  // The filter can move to another project while a removal is still running.
  const finishProjectRemoval = (projectKey: string | null) => {
    if (getSelectedProjectKey() !== projectKey) return;
    if (navigation.isFocused())
      leaveSettingsPage(navigation, workspaceHasColumns(), DEFAULT_SETTINGS_PAGE);
    // Otherwise the filter keeps pointing at the removed project as an unavailable one.
    selectProject(null);
  };
  const group = projectGroups.find((entry) => entry.key === selectedProjectKey);
  const selectedEnvironmentIds = new Set(selectedTargets.map((entry) => entry.environmentId));
  const members =
    group?.members
      .map((entry) => entry.project)
      .filter((project) => selectedEnvironmentIds.has(project.environmentId)) ?? [];

  return (
    <>
      <SettingsEnvironmentFilterHeader />
      <SettingsScreen title="Bots" menus={[environmentMenu]}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
          className="flex-1"
          contentContainerClassName="gap-6 px-5 pt-4"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        >
          {selectedProjectKey === null ? (
            <Text className="px-2 text-base text-foreground-muted">
              Choose a bot with the filter above to manage its name, connectors, archive and
              deletion.
            </Text>
          ) : !group || members.length === 0 ? (
            <Text className="px-2 text-base text-foreground-muted">
              This bot is not on the selected connected environments. Change the filter above.
            </Text>
          ) : (
            <ProjectOverviewContent
              key={`${selectedProjectKey}:${members.map((member) => member.id).join(",")}`}
              members={members}
              group={group}
              connectedTargets={availableTargets}
              environments={selectedTargets}
              hasOtherMembers={members.length < (group?.members.length ?? 0)}
              isRemoving={isRemoving}
              setIsRemoving={setIsRemoving}
              startRemoval={startRemoval}
              finishRemoval={finishRemoval}
              projectKey={selectedProjectKey}
              onProjectRemoved={finishProjectRemoval}
            />
          )}
        </ScrollView>
      </SettingsScreen>
    </>
  );
}

function ProjectOverviewContent(props: {
  readonly members: readonly EnvironmentProject[];
  /** Archive belongs to the whole bot, even when the filter picks one machine. */
  readonly group: ProjectGroup;
  readonly connectedTargets: readonly SettingsTarget[];
  readonly environments: readonly SettingsTarget[];
  readonly hasOtherMembers: boolean;
  readonly isRemoving: boolean;
  readonly setIsRemoving: (isRemoving: boolean) => void;
  readonly startRemoval: () => boolean;
  readonly finishRemoval: () => void;
  readonly projectKey: string | null;
  readonly onProjectRemoved: (projectKey: string | null) => void;
}) {
  const { isRemoving, setIsRemoving, startRemoval, finishRemoval } = props;
  const representative = props.members[0]!;
  const displayName = deriveProjectGroupLabel({ representative, members: props.members });
  const [draftName, setDraftName] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const threads = useThreadShells();
  const allMembers = props.group.members.map((member) => member.project);
  const homeFolderUnavailableReason = botHomeFolderUnavailableReason(
    allMembers,
    threads,
    useAtomValue(environmentPresentations.providersByEnvironmentAtom),
  );
  const removableEnvironments = useEnvironmentsWithScope(allMembers, AuthOrchestrationOperateScope);
  const canRemoveGroup = props.members.every((member) =>
    removableEnvironments.has(member.environmentId),
  );
  const deleteProject = useAtomCommand(projectEnvironment.delete, { reportFailure: false });
  const updateProject = useAtomCommand(projectEnvironment.update, {
    label: "bot name update",
    reportFailure: true,
  });
  const organizeProject = useAtomCommand(projectEnvironment.update, {
    label: "project update",
    reportFailure: true,
  });
  const [isOrganizing, setIsOrganizing] = useState(false);
  const memberTargets = allMembers.map((member) =>
    props.connectedTargets.find((entry) => entry.environmentId === member.environmentId),
  );
  const offline = memberTargets.some((target) => target === undefined);
  // Older servers drop archive, so their projects do not offer it.
  // Offline members are checked when the write runs, so their reason can show.
  const canOrganize =
    allMembers.every(
      (member, index) =>
        memberTargets[index] === undefined || removableEnvironments.has(member.environmentId),
    ) &&
    memberTargets.every(
      (target) =>
        target === undefined ||
        target.serverConfig.environment.capabilities.projectOrganization === true,
    );
  // One machine at a time, stopping at the first failure, as web does.
  const organize = async (input: {
    readonly autonomy?: BotAutonomy;
    readonly canCreateBotsWithoutAsking?: boolean;
  }) => {
    setIsOrganizing(true);
    for (const member of allMembers) {
      if (!readEnvironmentScope(member.environmentId, AuthOrchestrationOperateScope)) {
        Dialog.alert("Failed to update project", "This connection can no longer change it.");
        break;
      }
      const result = await organizeProject({
        environmentId: member.environmentId,
        input: { projectId: member.id, ...input },
      });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          Dialog.alert(
            `Failed to update "${member.title}"`,
            error instanceof Error ? error.message : "An error occurred.",
          );
        }
        break;
      }
    }
    setIsOrganizing(false);
  };
  const archiveBot = useAtomCommand(projectEnvironment.archiveBot, { reportFailure: false });
  const unarchiveBot = useAtomCommand(projectEnvironment.unarchiveBot, { reportFailure: false });
  const projects = useProjects();
  const setArchived = async (archived: boolean, includeChildren = false) => {
    setIsOrganizing(true);
    for (const member of allMembers) {
      if (!readEnvironmentScope(member.environmentId, AuthOrchestrationOperateScope)) {
        Dialog.alert("Failed to update the bot", "This connection can no longer change it.");
        break;
      }
      const result = archived
        ? await archiveBot({
            environmentId: member.environmentId,
            input: { projectId: member.id, ...(includeChildren ? { includeChildren } : {}) },
          })
        : await unarchiveBot({
            environmentId: member.environmentId,
            input: { projectId: member.id },
          });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          Dialog.alert(
            `Failed to ${archived ? "archive" : "unarchive"} "${member.title}"`,
            error instanceof Error ? error.message : "An error occurred.",
          );
        }
        break;
      }
    }
    setIsOrganizing(false);
  };
  // A bot with live child bots asks whether they go too; one without archives at once.
  const archive = () => {
    const children = allMembers.reduce(
      (count, member) =>
        count +
        liveBotDescendants(projects, { environmentId: member.environmentId, projectId: member.id })
          .length,
      0,
    );
    if (children === 0) return void setArchived(true);
    Dialog.alert(
      `Archive ${displayName}?`,
      `It created ${children === 1 ? "a bot" : `${children} bots`} that ${children === 1 ? "is" : "are"} still running. Archive ${children === 1 ? "it" : "them"} too, or leave ${children === 1 ? "it" : "them"} running on ${children === 1 ? "its" : "their"} own.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: `Only ${displayName}`, onPress: () => void setArchived(true) },
        { text: "Archive all", onPress: () => void setArchived(true, true) },
      ],
    );
  };
  const nextName = (draftName ?? displayName).trim();
  const canSave = !isSaving && nextName.length > 0 && nextName !== displayName;

  const checkRemovalAccess = (members: readonly EnvironmentProject[]) => {
    const denied = members.find(
      (member) => !readEnvironmentScope(member.environmentId, AuthOrchestrationOperateScope),
    );
    if (!denied) return true;
    const environment = props.environments.find(
      (entry) => entry.environmentId === denied.environmentId,
    );
    Dialog.alert(
      "Failed to remove project",
      `This connection cannot change projects in ${environment?.label ?? "this environment"}.`,
    );
    return false;
  };

  const removeMembers = (members: readonly EnvironmentProject[]) => {
    if (!checkRemovalAccess(members) || !startRemoval()) return;
    const projectKey = props.projectKey;
    const plan = planProjectRemoval({
      members: members.map((member) => ({
        ...member,
        environmentLabel: props.environments.find(
          (entry) => entry.environmentId === member.environmentId,
        )?.label,
      })),
      groupMemberCount: props.members.length,
      hasOtherMembers: props.hasOtherMembers,
      displayName,
      threads,
      unloadedThreadCount: readUnloadedThreadCount(members, threads),
    });
    Dialog.confirm({
      title: plan.targetKind === "checkout" ? "Remove checkout" : "Remove project",
      message: plan.confirmationMessage,
      confirmText: plan.targetKind === "checkout" ? "Remove checkout" : "Remove project",
      destructive: true,
      onCancel: finishRemoval,
      onConfirm: () => {
        void (async () => {
          setIsRemoving(true);
          if (!checkRemovalAccess(members)) return;
          for (const member of members) {
            if (!checkRemovalAccess([member])) return;
            const result = await deleteProject({
              environmentId: member.environmentId,
              input: { projectId: member.id, force: true },
            });
            if (result._tag === "Failure") {
              if (!isAtomCommandInterrupted(result)) {
                const error = squashAtomCommandFailure(result);
                Dialog.alert(
                  `Failed to remove "${member.title}"`,
                  error instanceof Error ? error.message : "An error occurred.",
                );
              }
              return;
            }
            await waitForComposerDraftsLoaded()
              .then(() => {
                for (const draftKey of findNewTaskDraftKeys(
                  appAtomRegistry.get(composerDraftsAtom),
                  {
                    environmentId: member.environmentId,
                    projectId: member.id,
                  },
                )) {
                  clearComposerDraft(draftKey);
                }
              })
              .catch((error) => {
                console.warn("[project-removal] could not clear composer drafts", error);
              });
          }
          // Nothing is left to show once the whole project is gone.
          if (plan.targetKind === "project") props.onProjectRemoved(projectKey);
        })().finally(finishRemoval);
      },
    });
  };

  const saveName = () => {
    if (!canSave) return;
    setIsSaving(true);
    void (async () => {
      const results = await Promise.all(
        props.members.map((member) =>
          updateProject({
            environmentId: member.environmentId,
            input: { projectId: member.id, title: nextName },
          }),
        ),
      );
      setIsSaving(false);
      if (results.every((result) => result._tag !== "Failure")) setDraftName(null);
    })();
  };

  return (
    <>
      <View className="flex-row items-center gap-4 px-2">
        <ProjectFavicon
          environmentId={representative.environmentId}
          projectTitle={representative.title}
          workspaceRoot={representative.workspaceRoot}
          faviconPath={representative.faviconPath}
          projectIcon={representative.projectIcon}
          size={48}
        />
        <View className="min-w-0 flex-1">
          <Text className="text-xl font-t3-semibold text-foreground" numberOfLines={2}>
            {displayName}
          </Text>
          <Text className="text-sm text-foreground-muted" numberOfLines={1}>
            {props.members
              .map(
                (member) =>
                  props.environments.find((entry) => entry.environmentId === member.environmentId)
                    ?.label ?? "Environment",
              )
              .join(", ")}
          </Text>
        </View>
      </View>

      <SettingsSection title="Bot">
        <View className="gap-3 p-4">
          <Text className="text-sm font-t3-medium text-foreground-muted">Name</Text>
          <View className="flex-row items-center gap-3">
            <AppTextInput
              accessibilityLabel="Bot name"
              className="min-h-11 min-w-0 flex-1 rounded-xl border-continuous bg-card px-3 text-base text-foreground"
              value={draftName ?? displayName}
              onChangeText={setDraftName}
              onSubmitEditing={saveName}
              returnKeyType="done"
              editable={!isSaving}
            />
            {canSave ? (
              <Button
                label="Save"
                accessibilityHint="Save bot name"
                tone="secondary"
                onPress={saveName}
              />
            ) : null}
          </View>
        </View>
        {canOrganize ? (
          <SettingsSwitchRow
            icon="house"
            label="Stay in its home folder"
            subtitle={
              offline
                ? "Connect every machine with this project to change this."
                : `Limits the bot's file changes and commands to its home folder. Applies from its next session.${homeFolderUnavailableReason === undefined ? "" : `\n${homeFolderUnavailableReason}`}`
            }
            value={allMembers.every((member) => member.autonomy === "home-folder")}
            disabled={isOrganizing || offline}
            onValueChange={(confined) =>
              void organize({ autonomy: confined ? "home-folder" : "full" })
            }
          />
        ) : null}
        {canOrganize ? (
          <SettingsSwitchRow
            icon="sparkles"
            label="Can create bots without asking"
            subtitle={
              offline
                ? "Connect every machine with this project to change this."
                : "Lets this bot create new bots without showing you an approval card first."
            }
            value={allMembers.every((member) => member.canCreateBotsWithoutAsking === true)}
            disabled={isOrganizing || offline}
            onValueChange={(allowed) => void organize({ canCreateBotsWithoutAsking: allowed })}
          />
        ) : null}
      </SettingsSection>

      {allMembers.map((member) => (
        <BotConnectorsSection
          key={`${member.environmentId}:${member.id}`}
          bot={member}
          environmentLabel={
            allMembers.length > 1
              ? props.environments.find(
                  (environment) => environment.environmentId === member.environmentId,
                )?.label
              : null
          }
        />
      ))}

      {canOrganize ? (
        <SettingsSection title="Organize">
          <SettingsActionRow
            icon="archivebox"
            label={props.group.archived ? "Unarchive bot" : "Archive bot"}
            description={
              props.group.archived
                ? "Archived: its routines are paused and it is out of the bot list. Unarchiving turns back on the routines that were running."
                : "Pauses its routines and heartbeat and moves it out of the bot list. Its conversation and home folder are kept."
            }
            disabled={isOrganizing || offline}
            onPress={() => (props.group.archived ? void setArchived(false) : archive())}
          />
        </SettingsSection>
      ) : null}

      <SettingsSection title="Danger">
        {props.members.length === 1 && !props.hasOtherMembers ? (
          <DeleteBotRow
            bot={representative}
            name={displayName}
            disabled={!canRemoveGroup || isRemoving}
            onDeleted={() => props.onProjectRemoved(props.projectKey)}
          />
        ) : (
          <SettingsActionRow
            icon="trash"
            label={
              props.hasOtherMembers
                ? "Remove checkout"
                : props.members.length > 1
                  ? "Remove this project everywhere"
                  : "Remove project"
            }
            description={
              props.hasOtherMembers
                ? "Deletes the selected machine's checkout entries and their threads. Other machines and files on disk are not touched."
                : props.members.length > 1
                  ? `Deletes all ${props.members.length} checkout entries and their threads on every machine. Files on disk are not touched.`
                  : "Deletes the project entry and its threads. Files on disk are not touched."
            }
            tone="danger"
            disabled={!canRemoveGroup || isRemoving}
            loading={isRemoving}
            onPress={() => removeMembers(props.members)}
          />
        )}
      </SettingsSection>
    </>
  );
}

/** Delete asks for the bot's name, and keeps its home folder unless the switch is on. */
function DeleteBotRow(props: {
  readonly bot: EnvironmentProject;
  readonly name: string;
  readonly disabled: boolean;
  readonly onDeleted: () => void;
}) {
  const deleteBot = useAtomCommand(projectEnvironment.deleteBot, { reportFailure: false });
  const [confirming, setConfirming] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [removeHomeFolder, setRemoveHomeFolder] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const confirmed = typedName.trim() === props.name.trim();

  const submit = async () => {
    if (!confirmed || deleting) return;
    setDeleting(true);
    const result = await deleteBot({
      environmentId: props.bot.environmentId,
      input: { projectId: props.bot.id, ...(removeHomeFolder ? { removeHomeFolder } : {}) },
    });
    setDeleting(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        Dialog.alert(
          `Failed to delete "${props.name}"`,
          error instanceof Error ? error.message : "An error occurred.",
        );
      }
      return;
    }
    props.onDeleted();
  };

  if (!confirming) {
    return (
      <SettingsActionRow
        icon="trash"
        label="Delete bot"
        description="Deletes its conversation, threads and routines. You choose whether its home folder goes too."
        tone="danger"
        disabled={props.disabled}
        onPress={() => setConfirming(true)}
      />
    );
  }
  return (
    <>
      <View className="gap-3 p-4">
        <Text className="text-sm text-foreground-muted">
          Deletes its conversation, threads and routines. This cannot be undone. Type{" "}
          <Text className="font-t3-semibold text-foreground">{props.name}</Text> to confirm.
        </Text>
        <AppTextInput
          accessibilityLabel={`Type ${props.name} to confirm`}
          className="min-h-11 rounded-xl border-continuous bg-card px-3 text-base text-foreground"
          value={typedName}
          onChangeText={setTypedName}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
        />
      </View>
      <SettingsSwitchRow
        icon="folder"
        label="Also delete its home folder"
        subtitle="Removes its files and memory from its machine. Off keeps the folder."
        value={removeHomeFolder}
        disabled={deleting}
        onValueChange={setRemoveHomeFolder}
      />
      <View className="flex-row justify-end gap-3 p-4">
        <Button label="Cancel" tone="secondary" onPress={() => setConfirming(false)} />
        <Button
          label="Delete bot"
          tone="danger"
          disabled={!confirmed || props.disabled}
          loading={deleting}
          onPress={() => void submit()}
        />
      </View>
    </>
  );
}
