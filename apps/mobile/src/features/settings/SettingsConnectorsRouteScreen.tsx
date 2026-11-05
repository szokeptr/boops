import { useAtomValue } from "@effect/atom-react";
import {
  botsUsingConnection,
  catalogChoice,
  connectionStatusLabel,
  connectorFailureMessage,
  INSECURE_REDIRECT_WARNING,
  searchConnectorCatalog,
} from "@t3tools/client-runtime/connectors";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  type ConnectorCatalogEntry,
  type ConnectorConnection,
  type ConnectorConnectionId,
  resolveEnvironmentMachineKind,
} from "@t3tools/contracts";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EnvironmentMachineSymbol } from "../../components/EnvironmentMachineSymbol";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { ControlPill } from "../../components/ui/ControlPill";
import * as Dialog from "../../components/ui/Dialog";
import { Menu } from "../../components/ui/Menu";
import { Notice } from "../../components/ui/Notice";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import {
  connectorEnvironment,
  useConnectorCatalog,
  useConnectorConnections,
  useEnvironmentBots,
} from "../../state/connectors";
import { useAtomCommand } from "../../state/use-atom-command";
import { ConnectorIcon } from "../connectors/ConnectorIcon";
import { ConnectorClientSheet } from "../connectors/ConnectorClientSheet";
import { ConnectorKeySheet } from "../connectors/ConnectorKeySheet";
import { TurnOnForBotsSheet } from "../connectors/TurnOnForBotsSheet";
import { useConnectorSignIn } from "../connectors/useConnectorSignIn";
import {
  SettingsEnvironmentFilterHeader,
  useSettingsEnvironmentMenu,
} from "./components/SettingsEnvironmentFilterHeader";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { type SettingsTarget, useSettingsEnvironmentFilter } from "./settings-environment-filter";

const INPUT_CLASS = "min-h-11 rounded-xl border-continuous bg-card px-3 text-base text-foreground";

export function SettingsConnectorsRouteScreen() {
  const insets = useSafeAreaInsets();
  const environmentMenu = useSettingsEnvironmentMenu();
  const { availableTargets, selectedTargets } = useSettingsEnvironmentFilter();
  return (
    <>
      <SettingsEnvironmentFilterHeader />
      <SettingsScreen title="Connectors" menus={[environmentMenu]}>
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
              <EnvironmentConnectors
                key={environment.environmentId}
                environment={environment}
                labelled={selectedTargets.length > 1}
              />
            ))
          ) : (
            <Text className="px-2 text-base text-foreground-muted">
              {availableTargets.length === 0
                ? "Connect an environment to manage the services its bots can use."
                : "No environments match these filters. Change the filter above."}
            </Text>
          )}
        </ScrollView>
      </SettingsScreen>
    </>
  );
}

function EnvironmentConnectors(props: {
  readonly environment: SettingsTarget;
  readonly labelled: boolean;
}) {
  const environmentId = props.environment.environmentId;
  const { connections, loaded, error } = useConnectorConnections(environmentId);
  const catalog = useConnectorCatalog(environmentId);
  const canManage = useAtomValue(connectorEnvironment.startOAuth.permissionAtom(environmentId));
  const [picked, setPicked] = useState<ConnectorConnectionId | null>(null);
  const signIn = useConnectorSignIn(environmentId, { onConnected: setPicked });
  const [query, setQuery] = useState("");
  const [customUrl, setCustomUrl] = useState("");
  const pending = signIn.pending;
  const pickerConnection =
    connections.find((connection) => connection.id === picked) ??
    (signIn.finished && pending?.fresh === true
      ? connections.find((connection) => connection.id === pending.connectionId)
      : undefined);
  const disabled = signIn.busy || !canManage;
  const shown = searchConnectorCatalog(catalog.entries, query);
  const url = customUrl.trim();
  const validUrl = /^https?:\/\/[^\s/]+/i.test(url);

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
          This session can see connections on {props.environment.label} but not change them.
        </Text>
      ) : null}
      {pending !== null && !signIn.finished ? (
        <View className="gap-2">
          <Notice
            icon="arrow.up.right"
            message={`Finish signing in to ${pending.name} in the browser. This updates when you're done.`}
            onDismiss={signIn.clearPending}
          />
          <ControlPill variant="pill" label="Open the sign-in page again" onPress={signIn.reopen} />
        </View>
      ) : null}
      {signIn.error !== null ? (
        <Notice tone="danger" icon="exclamationmark.triangle" message={signIn.error} />
      ) : null}
      <SettingsSection title="Connected">
        {!loaded ? (
          <Text className="p-4 text-base text-foreground-muted">
            {error ?? "Loading connections…"}
          </Text>
        ) : connections.length === 0 ? (
          <Text className="p-4 text-base text-foreground-muted">
            Nothing connected yet. Connect a service from the gallery below.
          </Text>
        ) : (
          connections.map((connection, index) => (
            <ConnectionRow
              key={connection.id}
              environmentId={environmentId}
              connection={connection}
              entry={catalog.entries.find((entry) => entry.id === connection.catalogId)}
              separated={index > 0}
              disabled={disabled}
              onSignIn={() => void signIn.signInAgain(connection)}
              onChooseBots={() => setPicked(connection.id)}
            />
          ))
        )}
      </SettingsSection>
      <SettingsSection title="Gallery">
        <View className="px-4 pt-3">
          <TextInput
            accessibilityLabel="Search connectors"
            placeholder="Search connectors"
            className={INPUT_CLASS}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            autoCapitalize="none"
          />
        </View>
        {signIn.redirect?.insecureRemote === true ? (
          <View className="px-4 pt-3">
            <Notice icon="exclamationmark.triangle" message={INSECURE_REDIRECT_WARNING} />
          </View>
        ) : null}
        {catalog.error !== null && catalog.entries.length === 0 ? (
          <Text className="p-4 text-base text-danger-foreground">{catalog.error}</Text>
        ) : shown.length === 0 ? (
          <Text className="p-4 text-base text-foreground-muted">
            No connector matches. Add it by URL below.
          </Text>
        ) : (
          shown.map((entry, index) => (
            <GalleryRow
              key={entry.id}
              entry={entry}
              count={connections.filter((c) => c.catalogId === entry.id).length}
              separated={index > 0}
              disabled={disabled}
              onConnect={() => void signIn.connect(catalogChoice(entry))}
            />
          ))
        )}
      </SettingsSection>
      <SettingsSection
        title="Add custom"
        footer="Any remote MCP server that speaks Streamable HTTP. The server is asked how it signs in."
      >
        <View className="flex-row items-center gap-2 p-4">
          <TextInput
            accessibilityLabel="MCP server URL"
            placeholder="https://example.com/mcp"
            className={`${INPUT_CLASS} min-w-0 flex-1`}
            value={customUrl}
            onChangeText={setCustomUrl}
            keyboardType="url"
            autoCorrect={false}
            autoCapitalize="none"
            spellCheck={false}
          />
          <ControlPill
            variant="primary"
            label="Connect"
            disabled={disabled || !validUrl}
            onPress={() => {
              void signIn.connect({
                target: { url },
                name: hostOf(url),
                signIn: "detect",
                entry: null,
              });
              setCustomUrl("");
            }}
          />
        </View>
      </SettingsSection>
      {signIn.clientPrompt !== null ? (
        <ConnectorClientSheet
          prompt={signIn.clientPrompt}
          busy={signIn.busy}
          onSubmit={signIn.submitClient}
          onClose={signIn.closeClientPrompt}
        />
      ) : null}
      {signIn.keyPrompt !== null ? (
        <ConnectorKeySheet
          prompt={signIn.keyPrompt}
          busy={signIn.busy}
          onSubmit={signIn.submitKey}
          onClose={signIn.closeKeyPrompt}
        />
      ) : null}
      {pickerConnection !== undefined ? (
        <TurnOnForBotsSheet
          environmentId={environmentId}
          connection={pickerConnection}
          onClose={() => {
            setPicked(null);
            signIn.clearPending();
          }}
        />
      ) : null}
    </View>
  );
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

function GalleryRow(props: {
  readonly entry: ConnectorCatalogEntry;
  readonly count: number;
  readonly separated: boolean;
  readonly disabled: boolean;
  readonly onConnect: () => void;
}) {
  const { entry } = props;
  return (
    <View
      className={
        props.separated
          ? "flex-row items-center gap-3 border-t border-border-subtle px-4 py-3"
          : "flex-row items-center gap-3 px-4 py-3"
      }
    >
      <ConnectorIcon name={entry.name} iconUrl={entry.iconUrl} />
      <View className="min-w-0 flex-1 gap-0.5">
        <Text textRole="body" className="text-foreground" numberOfLines={1}>
          {entry.name}
        </Text>
        <Text className="text-sm text-foreground-muted" numberOfLines={2}>
          {entry.description}
          {props.count > 0 ? ` · ${props.count} connected` : ""}
        </Text>
      </View>
      <ControlPill
        variant={props.count > 0 ? "pill" : "primary"}
        label={props.count > 0 ? "Add" : "Connect"}
        accessibilityLabel={`Connect ${entry.name}`}
        disabled={props.disabled}
        onPress={props.onConnect}
      />
    </View>
  );
}

function ConnectionRow(props: {
  readonly environmentId: SettingsTarget["environmentId"];
  readonly connection: ConnectorConnection;
  readonly entry: ConnectorCatalogEntry | undefined;
  readonly separated: boolean;
  readonly disabled: boolean;
  readonly onSignIn: () => void;
  readonly onChooseBots: () => void;
}) {
  const { connection, environmentId } = props;
  const bots = botsUsingConnection(useEnvironmentBots(environmentId), connection.id);
  const quiet = { reportFailure: false } as const;
  const test = useAtomCommand(connectorEnvironment.test, quiet);
  const disconnect = useAtomCommand(connectorEnvironment.disconnect, quiet);
  const remove = useAtomCommand(connectorEnvironment.remove, quiet);
  const rename = useAtomCommand(connectorEnvironment.rename, quiet);
  const input = { connectionId: connection.id };

  const act = async <A, E>(
    title: string,
    run: () => Promise<AtomCommandResult<A, E>>,
    success?: (value: A) => string,
  ) => {
    const result = await run();
    if (result._tag === "Success") {
      if (success) Dialog.alert(success(result.value));
    } else if (!isAtomCommandInterrupted(result)) {
      Dialog.alert(title, connectorFailureMessage(squashAtomCommandFailure(result)));
    }
  };

  const tools =
    connection.toolCount === null
      ? null
      : `${connection.toolCount} ${connection.toolCount === 1 ? "tool" : "tools"}`;
  const usedBy =
    bots.length === 0 ? "No bot uses it yet" : `On for ${bots.map((bot) => bot.title).join(", ")}`;
  const canSignIn = connection.authKind !== "none";

  const onAction = (action: string) => {
    switch (action) {
      case "rename":
        Dialog.prompt({
          title: `Rename ${connection.displayName}`,
          initialValue: connection.displayName,
          confirmText: "Save",
          onConfirm: (value) => {
            const displayName = value.trim().slice(0, 80);
            if (displayName.length === 0) return;
            void act("Could not rename", () =>
              rename({ environmentId, input: { connectionId: connection.id, displayName } }),
            );
          },
        });
        return;
      case "test":
        void act(
          "Test failed",
          () => test({ environmentId, input }),
          ({ toolCount }) =>
            `${connection.displayName} answered with ${toolCount} ${toolCount === 1 ? "tool" : "tools"}`,
        );
        return;
      case "sign-in":
        props.onSignIn();
        return;
      case "bots":
        props.onChooseBots();
        return;
      case "disconnect":
        void act("Could not disconnect", () => disconnect({ environmentId, input }));
        return;
      case "remove":
        Dialog.confirm({
          title: `Remove ${connection.displayName}?`,
          message: `${
            bots.length === 0
              ? "No bot uses it. Its sign-in is deleted from the server."
              : `It turns off for ${bots.map((bot) => bot.title).join(", ")}, and its sign-in is deleted from the server.`
          } To keep it on for its bots and only sign out, use Disconnect.`,
          confirmText: "Remove",
          destructive: true,
          onConfirm: () =>
            void act("Could not remove the connection", () => remove({ environmentId, input })),
        });
    }
  };

  return (
    <View
      className={
        props.separated
          ? "flex-row items-center gap-3 border-t border-border-subtle px-4 py-3"
          : "flex-row items-center gap-3 px-4 py-3"
      }
    >
      <ConnectorIcon name={connection.displayName} iconUrl={props.entry?.iconUrl} />
      <View className="min-w-0 flex-1 gap-0.5">
        <Text textRole="body" className="text-foreground" numberOfLines={1}>
          {connection.displayName}
        </Text>
        <Text
          className={
            connection.status === "connected"
              ? "text-sm text-foreground-muted"
              : "text-sm text-danger-foreground"
          }
          numberOfLines={2}
        >
          {connectionStatusLabel(connection)}
        </Text>
        <Text className="text-sm text-foreground-muted" numberOfLines={2}>
          {[tools, usedBy].filter(Boolean).join(" · ")}
        </Text>
      </View>
      {connection.status !== "connected" ? (
        <ControlPill
          variant="primary"
          label={canSignIn ? "Sign in" : "Retry"}
          accessibilityLabel={
            canSignIn ? `Sign in to ${connection.displayName} again` : "Try again"
          }
          disabled={props.disabled}
          onPress={props.onSignIn}
        />
      ) : null}
      <Menu
        title={connection.displayName}
        actions={[
          { id: "bots", title: "Turn on for…" },
          { id: "rename", title: "Rename" },
          { id: "test", title: "Test" },
          ...(canSignIn ? [{ id: "sign-in", title: "Sign in again" }] : []),
          ...(canSignIn && connection.status !== "needs_auth"
            ? [{ id: "disconnect", title: "Disconnect" }]
            : []),
          { id: "remove", title: "Remove…", attributes: { destructive: true } },
        ].map((action) => ({
          ...action,
          attributes: { ...action.attributes, disabled: props.disabled },
        }))}
        onPressAction={({ nativeEvent }) => onAction(nativeEvent.event)}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Actions for ${connection.displayName}`}
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
  );
}
