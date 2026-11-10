import { StackActions, useNavigation } from "@react-navigation/native";
import { avatarColors, botBubbleColors } from "@t3tools/client-runtime/bot-avatar";
import {
  AuthOrchestrationOperateScope,
  BOT_AVATAR_HUES,
  BOT_AVATAR_SHAPES,
  type EnvironmentId,
  type ModelSelection,
  type ProjectAvatar,
} from "@t3tools/contracts";
import { familySpec, lookFor, rerollSpec } from "@t3tools/shared/botAvatar";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import * as Haptics from "expo-haptics";
import { useRef, useState } from "react";
import { Platform, Pressable, View } from "react-native";

import { EnvironmentMachineSymbol } from "../../components/EnvironmentMachineSymbol";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import {
  buildModelOptions,
  resolveDefaultableModelSelection,
  resolveNewTaskModelSelection,
} from "../../lib/modelOptions";
import { cn } from "../../lib/cn";
import { useEnvironmentServerConfig, useProjects, waitForProject } from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
import { useEnvironmentsWithScope } from "../../state/session";
import { useMemberEnvironments } from "../../state/members";
import { useRooms } from "../../state/rooms";
import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { BotAvatarSlot } from "../bots/BotAvatarSlot";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  AddProjectShell,
  ListRow,
  ListSection,
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
  // Someone else's environment shares bots with this device; it cannot host a new one.
  const memberEnvironmentIds = new Set(
    useMemberEnvironments().map((option) => option.environmentId),
  );
  const environments = allEnvironments.filter(
    (option) =>
      permitted.has(option.environmentId) && !memberEnvironmentIds.has(option.environmentId),
  );
  const [pickedEnvironmentId, setPickedEnvironmentId] = useState<EnvironmentId | null>(null);
  const environment =
    environments.find((option) => option.environmentId === pickedEnvironmentId) ??
    environments[0] ??
    null;
  const environmentId = environment?.environmentId ?? null;
  const config = useEnvironmentServerConfig(environmentId);
  const canCreateRoom = useRooms(environmentId).canCreate;
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
  const siblings = useProjects()
    .filter((project) => project.environmentId === environmentId && !project.isScratch)
    .map((project) => lookFor(project.avatar, project.title));
  // Seeded once, away from the siblings' looks, so typing a name never reshuffles the preview.
  const [look, setLook] = useState<ProjectAvatar>(() =>
    rerollSpec(familySpec("", siblings), siblings),
  );

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
      input: { name: trimmedName, modelSelection, avatar: look },
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
      <BotAvatarHero
        name={trimmedName}
        value={look}
        disabled={isSubmitting}
        onReroll={() => setLook(rerollSpec(look, siblings))}
      />
      <TextInput
        className="h-14 min-h-14 rounded-full px-5 py-0 text-center text-xl leading-snug"
        value={name}
        onChangeText={setName}
        maxLength={200}
        placeholder="Name your bot"
        // Done only dismisses: the look and model sit below the field and are still to be picked.
        returnKeyType="done"
        accessibilityLabel="Bot name"
      />
      <Text className="px-1 text-center text-sm leading-snug text-foreground-muted">
        It will introduce itself and ask you a few questions.
      </Text>
      <BotLookPicker name={trimmedName} value={look} disabled={isSubmitting} onChange={setLook} />
      <ModelChip
        label={selectedOption?.label ?? `Sign in to a provider on ${environment.label}`}
        detail={selectedOption?.providerLabel ?? null}
        open={modelsOpen}
        disabled={isSubmitting || modelOptions.length === 0}
        onPress={() => setModelsOpen((open) => !open)}
      />
      {modelsOpen ? (
        <ListSection>
          {modelOptions.map((option, index) => {
            const selected = option.key === selectedOption?.key;
            return (
              <ListRow
                key={option.key}
                title={option.label}
                subtitle={option.providerLabel}
                icon={null}
                selected={selected}
                disabled={isSubmitting}
                isFirst={index === 0}
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
          })}
        </ListSection>
      ) : null}
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
      <View className="h-3" />
      <BotCreateButton
        avatar={look}
        disabled={isSubmitting || trimmedName.length === 0 || modelSelection === null}
        loading={isSubmitting}
        onPress={() => void submit()}
      />
      {canCreateRoom ? (
        <Pressable
          accessibilityRole="button"
          disabled={isSubmitting}
          onPress={() =>
            navigation.dispatch(
              StackActions.replace("CreateRoom", { environmentId: environment.environmentId }),
            )
          }
          className="min-h-[44px] items-center justify-center self-center px-4 active:opacity-60"
        >
          <Text className="text-[15px] text-foreground-muted">Start a group chat instead</Text>
        </Pressable>
      ) : null}
    </AddProjectShell>
  );
}

const HERO_SIZE = 128;
const SHAPE_SIZE = 46;
const SWATCH_SIZE = 30;

const capitalize = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);

function tapHaptic() {
  void Haptics.selectionAsync();
}

/** The bot as the screen's hero; a tap shuffles its whole look. */
function BotAvatarHero(props: {
  readonly name: string;
  readonly value: ProjectAvatar;
  readonly disabled: boolean;
  readonly onReroll: () => void;
}) {
  const { value, name } = props;
  return (
    <View className="items-center pb-2 pt-2">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Shuffle look"
        disabled={props.disabled}
        onPress={() => {
          tapHaptic();
          props.onReroll();
        }}
        className="items-center justify-center active:opacity-80"
        style={{ width: HERO_SIZE + 24, height: HERO_SIZE + 24 }}
      >
        <View
          className="absolute rounded-full"
          style={{
            width: HERO_SIZE + 24,
            height: HERO_SIZE + 24,
            backgroundColor: avatarColors(value).body,
            opacity: 0.14,
          }}
        />
        <BotAvatarSlot avatar={value} name={name} status="idle" size={HERO_SIZE} />
        <View className="absolute bottom-1 right-1 h-9 w-9 items-center justify-center rounded-full border border-border bg-grouped-card">
          <SymbolView
            name={{ ios: "dice", android: "auto_awesome" }}
            size={17}
            tintColorClassName="accent-icon"
            type="monochrome"
          />
        </View>
      </Pressable>
    </View>
  );
}

/** Shape and colour, the two choices that tell bots apart at a glance. */
function BotLookPicker(props: {
  readonly name: string;
  readonly value: ProjectAvatar;
  readonly disabled: boolean;
  readonly onChange: (avatar: ProjectAvatar) => void;
}) {
  const { value, name } = props;
  const pick = (next: ProjectAvatar) => {
    tapHaptic();
    props.onChange(next);
  };
  return (
    <View className="items-center gap-4 py-2">
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Shape"
        className="flex-row flex-wrap justify-center gap-1"
        style={{ maxWidth: (SHAPE_SIZE + 14) * 4 + 12 }}
      >
        {BOT_AVATAR_SHAPES.map((shape) => {
          const selected = value.shape === shape;
          return (
            <Pressable
              key={shape}
              accessibilityRole="radio"
              accessibilityLabel={capitalize(shape)}
              accessibilityState={{ checked: selected }}
              disabled={props.disabled}
              onPress={() => pick({ ...value, shape })}
              className={cn(
                "items-center justify-center rounded-full border-2 active:opacity-70",
                selected ? "border-foreground" : "border-transparent",
              )}
              style={{ width: SHAPE_SIZE + 14, height: SHAPE_SIZE + 14 }}
            >
              <BotAvatarSlot
                avatar={{ ...value, shape, accessory: "none" }}
                name={name}
                status="idle"
                size={SHAPE_SIZE}
              />
            </Pressable>
          );
        })}
      </View>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Colour"
        className="flex-row flex-wrap justify-center gap-2"
        style={{ maxWidth: (SWATCH_SIZE + 10) * 6 + 8 * 5 }}
      >
        {BOT_AVATAR_HUES.map((hue) => {
          const selected = value.hue === hue;
          return (
            <Pressable
              key={hue}
              accessibilityRole="radio"
              accessibilityLabel={capitalize(hue)}
              accessibilityState={{ checked: selected }}
              disabled={props.disabled}
              onPress={() => pick({ ...value, hue })}
              hitSlop={4}
              className={cn(
                "items-center justify-center rounded-full border-2 active:opacity-70",
                selected ? "border-foreground" : "border-transparent",
              )}
              style={{ width: SWATCH_SIZE + 10, height: SWATCH_SIZE + 10 }}
            >
              <View
                className="rounded-full"
                style={{
                  width: SWATCH_SIZE,
                  height: SWATCH_SIZE,
                  backgroundColor: avatarColors({ ...value, hue }).body,
                }}
              />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Create, worn in the new bot's colour so the button reads as part of it. */
function BotCreateButton(props: {
  readonly avatar: ProjectAvatar;
  readonly disabled: boolean;
  readonly loading: boolean;
  readonly onPress: () => void;
}) {
  const colors = botBubbleColors(props.avatar);
  const inactive = props.disabled || props.loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Create bot"
      accessibilityState={{ disabled: inactive, busy: props.loading }}
      disabled={inactive}
      onPress={props.onPress}
      className={cn(
        "min-h-13 w-full flex-row items-center justify-center rounded-full px-6 active:opacity-80",
        props.disabled && !props.loading && "bg-subtle-strong",
      )}
      style={props.disabled && !props.loading ? undefined : { backgroundColor: colors.background }}
    >
      {props.loading ? (
        <AppActivityIndicator color={colors.foreground} />
      ) : (
        <Text
          className={cn("text-[17px] font-t3-bold", props.disabled && "text-foreground-muted")}
          style={props.disabled ? undefined : { color: colors.foreground }}
        >
          Create bot
        </Text>
      )}
    </Pressable>
  );
}

/** The model, one quiet tap away rather than a settings row. */
function ModelChip(props: {
  readonly label: string;
  readonly detail: string | null;
  readonly open: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Model, ${props.label}`}
      accessibilityState={{ expanded: props.open, disabled: props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      className="min-h-[44px] max-w-full flex-row items-center gap-2 self-center rounded-full bg-subtle px-4 active:opacity-70"
    >
      <SymbolView
        name={{ ios: "sparkles", android: "auto_awesome" }}
        size={14}
        tintColorClassName="accent-icon"
        type="monochrome"
      />
      <Text className="shrink text-[15px] font-t3-medium" numberOfLines={1}>
        {props.label}
      </Text>
      {props.detail ? (
        <Text className="shrink text-[15px] text-foreground-muted" numberOfLines={1}>
          {props.detail}
        </Text>
      ) : null}
      <SymbolView
        name={props.open ? "chevron.up" : "chevron.down"}
        size={11}
        tintColorClassName="accent-chevron"
        type="monochrome"
      />
    </Pressable>
  );
}
