import { useAtomValue } from "@effect/atom-react";
import { secretVaultFailureMessage } from "@t3tools/client-runtime/secret-request";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  type EnvironmentId,
  resolveEnvironmentMachineKind,
  type SecretVault,
  type SecretVaultEntry,
} from "@t3tools/contracts";
import { useState } from "react";
import { Modal, Platform, Pressable, ScrollView as NativeScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EnvironmentMachineSymbol } from "../../components/EnvironmentMachineSymbol";
import { RelativeTime } from "../../components/RelativeTime";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ControlPill } from "../../components/ui/ControlPill";
import * as Dialog from "../../components/ui/Dialog";
import { Menu } from "../../components/ui/Menu";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { useEnvironmentBots } from "../../state/connectors";
import { secretVaultEnvironment, useSecretVaults } from "../../state/secretVaults";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  SettingsEnvironmentFilterHeader,
  useSettingsEnvironmentMenu,
} from "./components/SettingsEnvironmentFilterHeader";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";
import { type SettingsTarget, useSettingsEnvironmentFilter } from "./settings-environment-filter";

const INPUT_CLASS = "min-h-11 rounded-xl border-continuous bg-card px-3 text-base text-foreground";
const ENTRY_NAME_PATTERN = /^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/;

export function SettingsVaultsRouteScreen() {
  const insets = useSafeAreaInsets();
  const environmentMenu = useSettingsEnvironmentMenu();
  const { availableTargets, selectedTargets } = useSettingsEnvironmentFilter();
  return (
    <>
      <SettingsEnvironmentFilterHeader />
      <SettingsScreen title="Vaults" menus={[environmentMenu]}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
          className="flex-1"
          contentContainerClassName="gap-5 px-5 pt-4"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        >
          {selectedTargets.length > 0 ? (
            selectedTargets.map((environment) => (
              <EnvironmentVaults
                key={environment.environmentId}
                environment={environment}
                labelled={selectedTargets.length > 1}
              />
            ))
          ) : (
            <Text className="px-2 text-base text-foreground-muted">
              {availableTargets.length === 0
                ? "Connect an environment to manage the secrets its bots keep."
                : "No environments match these filters. Change the filter above."}
            </Text>
          )}
        </ScrollView>
      </SettingsScreen>
    </>
  );
}

type Act = <A, E>(title: string, run: () => Promise<AtomCommandResult<A, E>>) => Promise<boolean>;

const act: Act = async (title, run) => {
  const result = await run();
  if (result._tag === "Success") return true;
  if (!isAtomCommandInterrupted(result)) {
    Dialog.alert(title, secretVaultFailureMessage(squashAtomCommandFailure(result)));
  }
  return false;
};

function EnvironmentVaults(props: {
  readonly environment: SettingsTarget;
  readonly labelled: boolean;
}) {
  const environmentId = props.environment.environmentId;
  const { vaults, loaded, error } = useSecretVaults(environmentId);
  const canManage = useAtomValue(secretVaultEnvironment.create.permissionAtom(environmentId));
  const create = useAtomCommand(secretVaultEnvironment.create, { reportFailure: false });

  const newVault = () =>
    Dialog.prompt({
      title: "New vault",
      placeholder: "Home",
      initialValue: "",
      confirmText: "Create",
      onConfirm: (value) => {
        const name = value.trim().slice(0, 80);
        if (name.length === 0) return;
        void act("Could not create the vault", () => create({ environmentId, input: { name } }));
      },
    });

  return (
    <View className="gap-5">
      {props.labelled ? (
        <View className="flex-row items-center gap-2 px-2">
          <EnvironmentMachineSymbol
            kind={resolveEnvironmentMachineKind(props.environment.serverConfig)}
            size={16}
            tintColorClassName="accent-foreground-muted"
          />
          <Text className="font-t3-bold text-base text-foreground">{props.environment.label}</Text>
        </View>
      ) : null}
      {!canManage ? (
        <Text className="px-2 text-sm text-foreground-muted">
          This session can see vaults on {props.environment.label} but not change them.
        </Text>
      ) : null}
      {!loaded ? (
        <Text className="px-2 text-base text-foreground-muted">{error ?? "Loading vaults…"}</Text>
      ) : vaults.length === 0 ? (
        <Text className="px-2 text-base text-foreground-muted">
          No vaults yet. When a bot asks for a secret, you can keep it in one.
        </Text>
      ) : (
        vaults.map((vault) => (
          <VaultSection
            key={vault.id}
            environmentId={environmentId}
            vault={vault}
            disabled={!canManage}
          />
        ))
      )}
      <View className="flex-row">
        <ControlPill variant="pill" label="New vault" disabled={!canManage} onPress={newVault} />
      </View>
    </View>
  );
}

type EntrySheet = { readonly kind: "add" } | { readonly kind: "replace"; entry: SecretVaultEntry };

function VaultSection(props: {
  readonly environmentId: EnvironmentId;
  readonly vault: SecretVault;
  readonly disabled: boolean;
}) {
  const { vault, environmentId, disabled } = props;
  const bots = useEnvironmentBots(environmentId);
  const quiet = { reportFailure: false } as const;
  const rename = useAtomCommand(secretVaultEnvironment.rename, quiet);
  const remove = useAtomCommand(secretVaultEnvironment.remove, quiet);
  const setBot = useAtomCommand(secretVaultEnvironment.setBot, quiet);
  const removeEntry = useAtomCommand(secretVaultEnvironment.removeEntry, quiet);
  const [sheet, setSheet] = useState<EntrySheet | null>(null);

  const onVaultAction = (action: string) => {
    if (action === "rename") {
      Dialog.prompt({
        title: `Rename ${vault.name}`,
        initialValue: vault.name,
        confirmText: "Save",
        onConfirm: (value) => {
          const name = value.trim().slice(0, 80);
          if (name.length === 0 || name === vault.name) return;
          void act("Could not rename the vault", () =>
            rename({ environmentId, input: { vaultId: vault.id, name } }),
          );
        },
      });
    } else if (action === "remove") {
      const count = vault.entries.length;
      Dialog.confirm({
        title: `Delete ${vault.name}?`,
        message:
          count === 0
            ? "Bots lose access to it."
            : `Its ${count === 1 ? "secret is" : `${count} secrets are`} deleted from the server, and bots lose access to ${count === 1 ? "it" : "them"}.`,
        confirmText: "Delete",
        destructive: true,
        onConfirm: () =>
          void act("Could not delete the vault", () =>
            remove({ environmentId, input: { vaultId: vault.id } }),
          ),
      });
    }
  };

  const onEntryAction = (entry: SecretVaultEntry, action: string) => {
    if (action === "replace") {
      setSheet({ kind: "replace", entry });
    } else if (action === "remove") {
      Dialog.confirm({
        title: `Delete ${entry.name}?`,
        message: "Bots that use it will have to ask for it again.",
        confirmText: "Delete",
        destructive: true,
        onConfirm: () =>
          void act("Could not delete the secret", () =>
            removeEntry({ environmentId, input: { entryId: entry.id } }),
          ),
      });
    }
  };

  return (
    <View className="gap-3">
      <View className="flex-row items-center gap-2 pl-2">
        <Text className="min-w-0 flex-1 font-t3-bold text-base text-foreground" numberOfLines={1}>
          {vault.name}
        </Text>
        <Menu
          title={vault.name}
          actions={[
            { id: "rename", title: "Rename", attributes: { disabled } },
            { id: "remove", title: "Delete…", attributes: { destructive: true, disabled } },
          ]}
          onPressAction={({ nativeEvent }) => onVaultAction(nativeEvent.event)}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Actions for ${vault.name}`}
            className="h-11 w-11 items-center justify-center"
          >
            <SymbolView
              name="ellipsis"
              size={18}
              tintColorClassName="accent-icon"
              type="monochrome"
            />
          </Pressable>
        </Menu>
      </View>
      <SettingsSection title="Secrets">
        {vault.entries.map((entry, index) => (
          <View
            key={entry.id}
            className={
              index > 0
                ? "flex-row items-center gap-3 border-t border-border-subtle py-3 pl-4"
                : "flex-row items-center gap-3 py-3 pl-4"
            }
          >
            <View className="min-w-0 flex-1 gap-0.5">
              <Text className="font-mono text-sm text-foreground" numberOfLines={1}>
                {entry.name}
              </Text>
              <Text className="text-sm text-foreground-muted" numberOfLines={2}>
                {entry.label} ·{" "}
                {entry.lastUsedAt === null ? (
                  "Never used"
                ) : (
                  <>
                    Used <RelativeTime timestamp={entry.lastUsedAt} /> ago
                  </>
                )}
              </Text>
            </View>
            <Menu
              title={entry.name}
              actions={[
                { id: "replace", title: "Replace value", attributes: { disabled } },
                { id: "remove", title: "Delete…", attributes: { destructive: true, disabled } },
              ]}
              onPressAction={({ nativeEvent }) => onEntryAction(entry, nativeEvent.event)}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Actions for ${entry.name}`}
                className="h-11 w-11 items-center justify-center"
              >
                <SymbolView
                  name="ellipsis"
                  size={18}
                  tintColorClassName="accent-icon"
                  type="monochrome"
                />
              </Pressable>
            </Menu>
          </View>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={() => setSheet({ kind: "add" })}
          className={
            vault.entries.length > 0
              ? "min-h-12 justify-center border-t border-border-subtle px-4 active:opacity-60 disabled:opacity-45"
              : "min-h-12 justify-center px-4 active:opacity-60 disabled:opacity-45"
          }
        >
          <Text textRole="body" className="text-primary">
            Add secret
          </Text>
        </Pressable>
      </SettingsSection>
      <SettingsSection title="Bots that can use it">
        {bots.length === 0 ? (
          <Text className="p-4 text-base text-foreground-muted">No bots yet.</Text>
        ) : (
          bots.map((bot) => (
            <SettingsSwitchRow
              key={bot.id}
              label={bot.title}
              value={vault.projectIds.includes(bot.id)}
              disabled={disabled}
              onValueChange={(enabled) =>
                void act(enabled ? "Could not turn the vault on" : "Could not turn it off", () =>
                  setBot({
                    environmentId,
                    input: { vaultId: vault.id, projectId: bot.id, enabled },
                  }),
                )
              }
            />
          ))
        )}
      </SettingsSection>
      {sheet !== null ? (
        <SecretEntrySheet
          environmentId={environmentId}
          vault={vault}
          replacing={sheet.kind === "replace" ? sheet.entry : null}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </View>
  );
}

/** The value lives only in this sheet's state and the request. */
function SecretEntrySheet(props: {
  readonly environmentId: EnvironmentId;
  readonly vault: SecretVault;
  readonly replacing: SecretVaultEntry | null;
  readonly onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { replacing, vault } = props;
  const putEntry = useAtomCommand(secretVaultEnvironment.putEntry, { reportFailure: false });
  const [name, setName] = useState(replacing?.name ?? "");
  const [label, setLabel] = useState(replacing?.label ?? "");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmedName = name.trim();
  const nameValid = trimmedName.length <= 64 && ENTRY_NAME_PATTERN.test(trimmedName);
  const taken = replacing === null && vault.entries.some((entry) => entry.name === trimmedName);
  const ready =
    !busy &&
    nameValid &&
    !taken &&
    label.trim().length > 0 &&
    label.trim().length <= 120 &&
    value.trim().length > 0;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    const result = await putEntry({
      environmentId: props.environmentId,
      input: { vaultId: vault.id, name: trimmedName, label: label.trim(), value: value.trim() },
    });
    setBusy(false);
    if (result._tag === "Success") {
      props.onClose();
    } else if (!isAtomCommandInterrupted(result)) {
      setError(secretVaultFailureMessage(squashAtomCommandFailure(result)));
    }
  };

  return (
    <Modal
      animationType="slide"
      presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"}
      onRequestClose={() => {
        if (!busy) props.onClose();
      }}
    >
      <NativeScrollView
        className="flex-1 bg-sheet-solid"
        contentContainerClassName="gap-5 p-5"
        contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="gap-1">
          <Text className="font-t3-bold text-lg text-foreground">
            {replacing === null ? `Add a secret to ${vault.name}` : `Replace ${replacing.name}`}
          </Text>
          <Text className="font-sans text-sm leading-5 text-foreground-muted">
            Bots this vault is on for can read it. It is never shown again.
          </Text>
        </View>
        {replacing === null ? (
          <View className="gap-2">
            <Text className="font-t3-medium text-sm text-foreground">Name</Text>
            <TextInput
              accessibilityLabel="Name"
              placeholder="home-assistant"
              className={INPUT_CLASS}
              value={name}
              onChangeText={setName}
              editable={!busy}
              autoCorrect={false}
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
            />
            <Text
              className={
                trimmedName.length > 0 && (!nameValid || taken)
                  ? "font-sans text-xs text-danger-foreground"
                  : "font-sans text-xs text-foreground-muted"
              }
            >
              {taken
                ? "This vault already has a secret with that name."
                : "How bots ask for it. Lowercase letters and numbers, joined by - _ or ."}
            </Text>
          </View>
        ) : null}
        <View className="gap-2">
          <Text className="font-t3-medium text-sm text-foreground">Label</Text>
          <TextInput
            accessibilityLabel="Label"
            placeholder="Home Assistant token"
            className={INPUT_CLASS}
            value={label}
            onChangeText={setLabel}
            editable={!busy}
          />
        </View>
        <View className="gap-2">
          <Text className="font-t3-medium text-sm text-foreground">Value</Text>
          <TextInput
            accessibilityLabel="Value"
            className={INPUT_CLASS}
            value={value}
            onChangeText={setValue}
            editable={!busy}
            secureTextEntry
            autoCorrect={false}
            autoCapitalize="none"
            autoComplete="off"
            textContentType="none"
            importantForAutofill="no"
            spellCheck={false}
            autoFocus={replacing !== null}
            onSubmitEditing={() => void submit()}
          />
        </View>
        {error !== null ? (
          <Text accessibilityRole="alert" className="font-sans text-sm text-danger-foreground">
            {error}
          </Text>
        ) : null}
        <Button
          label={busy ? "Saving…" : "Save"}
          tone="primary"
          disabled={!ready}
          onPress={() => void submit()}
          fullWidth
        />
        <Button label="Cancel" tone="secondary" disabled={busy} onPress={props.onClose} fullWidth />
      </NativeScrollView>
    </Modal>
  );
}
