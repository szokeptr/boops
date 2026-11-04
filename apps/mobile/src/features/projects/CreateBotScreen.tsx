import { StackActions, useNavigation } from "@react-navigation/native";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type ModelSelection,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { useRef, useState } from "react";
import { Platform } from "react-native";

import { EnvironmentMachineSymbol } from "../../components/EnvironmentMachineSymbol";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import {
  buildModelOptions,
  resolveDefaultableModelSelection,
  resolveNewTaskModelSelection,
} from "../../lib/modelOptions";
import { useEnvironmentServerConfig, waitForProject } from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
import { useEnvironmentsWithScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  AddProjectShell,
  ListRow,
  ListSection,
  PrimaryActionButton,
  SectionTitle,
  useEnvironmentOptions,
} from "./AddProjectScreen";

const ROW_ICON_SIZE = Platform.OS === "android" ? 24 : 17;

function Checkmark() {
  return (
    <SymbolView
      name="checkmark"
      size={Platform.OS === "android" ? 20 : 14}
      tintColorClassName="accent-icon"
      type="monochrome"
    />
  );
}

/** Names a new bot and its model, then opens its main thread, where it starts hatching. */
export function CreateBotScreen() {
  const navigation = useNavigation();
  const allEnvironments = useEnvironmentOptions().filter(
    (option) => option.connectionState === "connected",
  );
  const permitted = useEnvironmentsWithScope(allEnvironments, AuthOrchestrationOperateScope);
  const environments = allEnvironments.filter((option) => permitted.has(option.environmentId));
  const [pickedEnvironmentId, setPickedEnvironmentId] = useState<EnvironmentId | null>(null);
  const environment =
    environments.find((option) => option.environmentId === pickedEnvironmentId) ??
    environments[0] ??
    null;
  const environmentId = environment?.environmentId ?? null;
  const config = useEnvironmentServerConfig(environmentId);
  const modelOptions = buildModelOptions(config, null, undefined, null).filter(
    (option) => !option.isUnavailable && !option.isHidden,
  );
  // A pick belongs to the machine it was made on; switching machines falls back to its default.
  const [picked, setPicked] = useState<{
    readonly environmentId: EnvironmentId;
    readonly selection: ModelSelection;
  } | null>(null);
  const modelSelection = resolveNewTaskModelSelection({
    draftSelection: picked?.environmentId === environmentId ? picked.selection : null,
    projectDefaultSelection: resolveDefaultableModelSelection(
      config,
      config?.settings.defaultModelSelection ?? null,
      null,
    ),
    stickySelection: null,
    modelOptions,
  });
  const selectedOption = modelOptions.find(
    (option) =>
      option.selection.instanceId === modelSelection?.instanceId &&
      option.selection.model === modelSelection.model,
  );
  const [modelsOpen, setModelsOpen] = useState(false);
  const createBot = useAtomCommand(projectEnvironment.createBot, { reportFailure: false });
  const [name, setName] = useState("");
  const trimmedName = name.trim();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // State lags a render behind, so a double tap could start a second create.
  const submittingRef = useRef(false);
  const submit = async () => {
    if (
      environmentId === null ||
      modelSelection === null ||
      trimmedName.length === 0 ||
      submittingRef.current
    )
      return;
    submittingRef.current = true;
    setError(null);
    setIsSubmitting(true);
    const result = await createBot({
      environmentId,
      input: { name: trimmedName, modelSelection },
    });
    if (AsyncResult.isFailure(result)) {
      submittingRef.current = false;
      setIsSubmitting(false);
      const cause = Cause.squash(result.cause);
      setError(cause instanceof Error ? cause.message : "Could not create the bot.");
      return;
    }
    // The thread screen resolves the bot from the client store, so let the create arrive first.
    await waitForProject({ environmentId, projectId: result.value.projectId });
    submittingRef.current = false;
    setIsSubmitting(false);
    navigation.dispatch(
      StackActions.replace("Thread", { environmentId, threadId: result.value.mainThreadId }),
    );
  };

  if (environment === null) {
    return (
      <AddProjectShell title="New bot">
        <Text className="px-1 text-base leading-snug text-foreground-muted">
          Connect to a machine first. A bot lives on the machine that runs it.
        </Text>
      </AddProjectShell>
    );
  }

  return (
    <AddProjectShell title="New bot">
      {error ? <ErrorBanner message={error} /> : null}
      {/* BotAvatarPicker slot: avatar preview and reroll go here once avatars land. */}
      <TextInput
        className="h-12 min-h-12 rounded-[24px] px-4 py-0 text-base leading-snug"
        value={name}
        onChangeText={setName}
        maxLength={200}
        autoFocus
        placeholder="Bot name"
        returnKeyType="done"
        onSubmitEditing={() => void submit()}
      />
      <Text className="px-1 text-sm leading-snug text-foreground-muted">
        It will introduce itself and ask you a few questions.
      </Text>
      <SectionTitle>Model</SectionTitle>
      <ListSection>
        <ListRow
          title={selectedOption?.label ?? "No model available"}
          subtitle={
            selectedOption?.providerLabel ?? `Sign in to a provider on ${environment.label}`
          }
          icon={
            <SymbolView
              name={{ ios: "sparkles", android: "auto_awesome" }}
              size={ROW_ICON_SIZE}
              tintColorClassName="accent-icon"
              type="monochrome"
            />
          }
          disabled={isSubmitting || modelOptions.length === 0}
          isFirst
          onPress={() => setModelsOpen((open) => !open)}
        />
        {modelsOpen
          ? modelOptions.map((option) => {
              const selected = option.key === selectedOption?.key;
              return (
                <ListRow
                  key={option.key}
                  title={option.label}
                  subtitle={option.providerLabel}
                  icon={null}
                  selected={selected}
                  disabled={isSubmitting}
                  right={selected ? <Checkmark /> : null}
                  onPress={() => {
                    setPicked({
                      environmentId: environment.environmentId,
                      selection: option.selection,
                    });
                    setModelsOpen(false);
                  }}
                />
              );
            })
          : null}
      </ListSection>
      {environments.length > 1 ? (
        <>
          <SectionTitle>Lives on</SectionTitle>
          <ListSection>
            {environments.map((option, index) => {
              const selected = option.environmentId === environment.environmentId;
              return (
                <ListRow
                  key={option.environmentId}
                  title={option.label}
                  icon={
                    <EnvironmentMachineSymbol
                      kind={option.machine}
                      size={ROW_ICON_SIZE}
                      tintColorClassName="accent-icon"
                    />
                  }
                  selected={selected}
                  disabled={isSubmitting}
                  isFirst={index === 0}
                  right={selected ? <Checkmark /> : null}
                  onPress={() => setPickedEnvironmentId(option.environmentId)}
                />
              );
            })}
          </ListSection>
        </>
      ) : null}
      <PrimaryActionButton
        label="Create bot"
        disabled={isSubmitting || trimmedName.length === 0 || modelSelection === null}
        onPress={() => void submit()}
        loading={isSubmitting}
      />
    </AddProjectShell>
  );
}
