import { pipe } from "effect/Function";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  SECRET_REQUEST_DEFAULT_PLACEHOLDER,
  secretKeepVaultId,
  secretKeepVaultLabel,
  secretRequestAnswerInput,
  secretRequestDisplay,
  secretRequestFailureMessage,
  secretRequestKeepOptions,
  secretRequestPrivacyNote,
  type SecretRequestItem,
} from "@t3tools/client-runtime/secret-request";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  OrchestrationV2ProjectedTurnItem,
  SecretVaultId,
} from "@t3tools/contracts";
import { useRef, useState } from "react";
import { Pressable, View, type ColorValue } from "react-native";

import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Menu } from "../../components/ui/Menu";
import { ThemedSwitch } from "../../components/ui/ThemedSwitch";
import { useProject, useThreadShell } from "../../state/entities";
import { useSecretVaults } from "../../state/secretVaults";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../../components/ui/Button";

const LOCK_SYMBOL: AppSymbolName = { ios: "lock", android: "lock" };
const PRIVATE_SYMBOL: AppSymbolName = { ios: "checkmark.shield", android: "lock" };

export function SecretRequestCard(props: {
  readonly environmentId: EnvironmentId;
  readonly projectedItem: OrchestrationV2ProjectedTurnItem;
  readonly iconColor: ColorValue;
}) {
  const { item, visibility } = props.projectedItem;
  if (item.type !== "secret_request") return null;
  const display = secretRequestDisplay(item, visibility);
  if (display.kind === "pending") {
    return (
      <PendingSecretRequestForm
        environmentId={props.environmentId}
        item={item}
        iconColor={props.iconColor}
      />
    );
  }
  const icon: AppSymbolName =
    display.kind === "pending-elsewhere"
      ? LOCK_SYMBOL
      : display.outcome === "saved"
        ? "checkmark"
        : "minus";
  return (
    <View className="mb-3 flex-row items-start gap-2 px-1 py-2">
      <View className="h-5 justify-center">
        <SymbolView name={icon} size={13} tintColor={props.iconColor} type="monochrome" />
      </View>
      <Text className="flex-1 font-sans text-sm leading-5 text-foreground-muted" numberOfLines={2}>
        {item.label} · {display.label}
      </Text>
    </View>
  );
}

function PendingSecretRequestForm(props: {
  readonly environmentId: EnvironmentId;
  readonly item: SecretRequestItem;
  readonly iconColor: ColorValue;
}) {
  const { item, environmentId } = props;
  const shell = useThreadShell(scopeThreadRef(environmentId, item.threadId));
  const bot = useProject(shell === null ? null : scopeProjectRef(environmentId, shell.projectId));
  const { vaults } = useSecretVaults(item.keepAs === undefined ? null : environmentId);
  const keepOptions = secretRequestKeepOptions(item, vaults, bot?.id ?? null);
  const botName = bot?.title ?? "this bot";
  const [keep, setKeep] = useState(true);
  const [chosenVault, setChosenVault] = useState<SecretVaultId | null>(null);
  const keepVaultId =
    keepOptions === null
      ? null
      : secretKeepVaultId(keepOptions, chosenVault ?? keepOptions.vaults[0]?.id ?? null);
  const keeping = keepOptions !== null && keep;
  const answer = useAtomCommand(serverEnvironment.answerSecretRequest, {
    label: "answer secret request",
    // The failure cause holds the request; keep it out of the console.
    reportFailure: false,
    reportDefect: false,
  });
  const [secret, setSecret] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Submit then a tap can both run before a re-render; this guard is synchronous.
  const inFlight = useRef(false);

  const send = async (
    reply:
      | {
          readonly type: "save";
          readonly secret: string;
          readonly keep?: { readonly vaultId: SecretVaultId | null } | undefined;
        }
      | { readonly type: "decline" },
  ) => {
    const input = secretRequestAnswerInput(item, reply);
    if (input === null || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    const result = await answer({ environmentId, input }).finally(() => {
      inFlight.current = false;
      setSubmitting(false);
    });
    if (result._tag === "Success") {
      setSecret("");
      return;
    }
    if (!isAtomCommandInterrupted(result)) {
      pipe(squashAtomCommandFailure(result), secretRequestFailureMessage, setError);
    }
  };

  const save = () =>
    void send({ type: "save", secret, keep: keeping ? { vaultId: keepVaultId } : undefined });
  const keepVaultName = keepOptions?.vaults.find((vault) => vault.id === keepVaultId)?.name;

  return (
    <View className="mb-3 gap-3 rounded-[20px] border border-border bg-card-alt p-4">
      <View className="gap-1">
        <Text className="font-t3-bold text-base text-foreground">{item.label}</Text>
        {item.reason.trim() ? (
          <Text className="font-sans text-sm leading-5 text-foreground-muted" selectable>
            {item.reason}
          </Text>
        ) : null}
        {item.replace === true && keepOptions?.holder != null ? (
          <Text className="font-sans text-sm leading-5 text-foreground-muted">
            The kept value stopped working. Saving replaces it.
          </Text>
        ) : null}
      </View>
      <TextInput
        accessibilityLabel={item.label}
        placeholder={item.placeholder ?? SECRET_REQUEST_DEFAULT_PLACEHOLDER}
        value={secret}
        onChangeText={setSecret}
        editable={!submitting}
        secureTextEntry
        autoCorrect={false}
        autoCapitalize="none"
        autoComplete="off"
        textContentType="none"
        importantForAutofill="no"
        spellCheck={false}
        returnKeyType="done"
        onSubmitEditing={save}
      />
      {keepOptions !== null ? (
        <View className="gap-2">
          <View className="flex-row items-center gap-3">
            <Text className="flex-1 font-sans text-sm text-foreground">
              Keep for {botName} as <Text className="font-mono text-sm">{keepOptions.name}</Text>
            </Text>
            <ThemedSwitch
              accessibilityLabel={`Keep for ${botName} as ${keepOptions.name}`}
              value={keep}
              disabled={submitting}
              onValueChange={setKeep}
            />
          </View>
          {keep && keepOptions.holder === null && keepOptions.vaults.length > 1 ? (
            <Menu
              title="Keep in"
              actions={keepOptions.vaults.map((vault) => ({
                id: vault.id,
                title: vault.name,
                state: vault.id === keepVaultId ? ("on" as const) : ("off" as const),
                attributes: { disabled: submitting },
              }))}
              onPressAction={({ nativeEvent }) =>
                setChosenVault(nativeEvent.event as SecretVaultId)
              }
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Vault: ${keepVaultName ?? ""}`}
                disabled={submitting}
                hitSlop={8}
                className="flex-row items-center gap-1 self-start active:opacity-60"
              >
                <Text className="font-sans text-sm text-foreground-muted">In {keepVaultName}</Text>
                <SymbolView
                  name="chevron.down"
                  size={11}
                  tintColor={props.iconColor}
                  type="monochrome"
                />
              </Pressable>
            </Menu>
          ) : null}
        </View>
      ) : null}
      {error !== null ? (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          className="font-sans text-sm text-danger-foreground"
        >
          {error}
        </Text>
      ) : null}
      <Button
        label="Save securely"
        tone="primary"
        fullWidth
        disabled={submitting || secret.trim().length === 0}
        onPress={save}
      />
      <View className="flex-row items-center justify-between gap-2">
        <View className="flex-1 flex-row items-center gap-1.5">
          <SymbolView
            name={PRIVATE_SYMBOL}
            size={13}
            tintColor={props.iconColor}
            type="monochrome"
          />
          <Text className="flex-1 font-sans text-xs text-foreground-muted">
            {secretRequestPrivacyNote(
              item,
              keeping ? secretKeepVaultLabel(keepOptions, keepVaultId, botName) : undefined,
            )}
          </Text>
        </View>
        <Button
          label="Decline"
          tone="text"
          disabled={submitting}
          onPress={() => void send({ type: "decline" })}
        />
      </View>
    </View>
  );
}
