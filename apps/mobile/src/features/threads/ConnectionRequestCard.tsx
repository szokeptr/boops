import { useAtomValue } from "@effect/atom-react";
import {
  connectionCardCopy,
  connectionCardState,
  connectionRequestChoice,
  connectionRequestDecline,
  connectionRequestUseExisting,
  connectorFailureMessage,
  INSECURE_REDIRECT_WARNING,
} from "@t3tools/client-runtime/connectors";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  ConnectorsAnswerRequestInput,
  EnvironmentId,
  OrchestrationV2ProjectedTurnItem,
} from "@t3tools/contracts";
import { useState } from "react";
import { Pressable, View, type ColorValue } from "react-native";

import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import {
  connectorEnvironment,
  useConnectorCatalog,
  useConnectorConnections,
} from "../../state/connectors";
import { useProject, useThreadShell } from "../../state/entities";
import { useAtomCommand } from "../../state/use-atom-command";
import { ConnectorIcon } from "../connectors/ConnectorIcon";
import { ConnectorClientSheet } from "../connectors/ConnectorClientSheet";
import { ConnectorKeySheet } from "../connectors/ConnectorKeySheet";
import { useConnectorSignIn } from "../connectors/useConnectorSignIn";
import { useSetBotConnection } from "../connectors/useSetBotConnection";

/**
 * A bot asked for a connector. What the card shows comes from the live connections and the
 * bot's `connectionIds`, so an answered card follows later changes; see web's card.
 */
export function ConnectionRequestCard(props: {
  readonly environmentId: EnvironmentId;
  readonly projectedItem: OrchestrationV2ProjectedTurnItem;
  readonly iconColor: ColorValue;
}) {
  const { item, visibility } = props.projectedItem;
  if (item.type !== "connection_request") return null;
  return (
    <ConnectionRequestCardBody
      environmentId={props.environmentId}
      item={item}
      visibility={visibility}
      iconColor={props.iconColor}
    />
  );
}

function ConnectionRequestCardBody(props: {
  readonly environmentId: EnvironmentId;
  readonly item: Extract<OrchestrationV2ProjectedTurnItem["item"], { type: "connection_request" }>;
  readonly visibility: OrchestrationV2ProjectedTurnItem["visibility"];
  readonly iconColor: ColorValue;
}) {
  const { item, environmentId } = props;
  const shell = useThreadShell(scopeThreadRef(environmentId, item.threadId));
  const bot = useProject(shell === null ? null : scopeProjectRef(environmentId, shell.projectId));
  const { connections } = useConnectorConnections(environmentId);
  const { entries } = useConnectorCatalog(environmentId);
  const canManage = useAtomValue(connectorEnvironment.answerRequest.permissionAtom(environmentId));
  const answer = useAtomCommand(connectorEnvironment.answerRequest, { reportFailure: false });
  const botSwitch = useSetBotConnection(environmentId);
  const signIn = useConnectorSignIn(environmentId, {
    forRequest: { threadId: item.threadId, turnItemId: item.id },
  });
  const [answering, setAnswering] = useState(false);
  const [answerError, setAnswerError] = useState<string | null>(null);

  const botName = bot?.title ?? "this bot";
  const state = connectionCardState({
    item,
    visibility: props.visibility,
    connections,
    botConnectionIds: bot?.connectionIds ?? [],
  });
  const copy = connectionCardCopy(state, botName);
  const choice = connectionRequestChoice(item, entries);

  if (
    state.kind === "connected" ||
    state.kind === "declined" ||
    state.kind === "ended" ||
    state.kind === "failed" ||
    state.kind === "waiting-elsewhere"
  ) {
    const icon: AppSymbolName =
      state.kind === "connected"
        ? "checkmark"
        : state.kind === "failed"
          ? "xmark"
          : state.kind === "waiting-elsewhere"
            ? "cable.connector"
            : "minus";
    return (
      <View className="mb-3 min-h-9 flex-row items-center gap-2 px-1">
        <SymbolView name={icon} size={13} tintColor={props.iconColor} type="monochrome" />
        <Text className="flex-1 font-sans text-sm text-foreground-muted" numberOfLines={2}>
          {state.kind === "connected" ? copy.status : `${item.label} · ${copy.status}`}
        </Text>
      </View>
    );
  }

  const respond = async (input: ConnectorsAnswerRequestInput) => {
    setAnswering(true);
    setAnswerError(null);
    const result = await answer({ environmentId, input });
    setAnswering(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      setAnswerError(connectorFailureMessage(squashAtomCommandFailure(result)));
    }
  };

  const act = () => {
    switch (state.kind) {
      case "connect":
        if (choice !== null) void signIn.connect(choice);
        return;
      case "use":
        void respond(connectionRequestUseExisting(item, state.connection.id));
        return;
      case "turn-on":
        if (!state.answered) {
          void respond(connectionRequestUseExisting(item, state.connection.id));
        } else if (bot !== null) {
          void botSwitch.set({
            projectId: bot.id,
            connectionId: state.connection.id,
            enabled: true,
          });
        }
        return;
      case "sign-in":
      case "retry":
        void signIn.signInAgain(state.connection);
    }
  };

  const busy = answering || signIn.busy;
  const waiting = signIn.pending !== null && !signIn.finished;
  const signsInWithOAuth =
    state.kind === "sign-in"
      ? state.connection.authKind === "oauth"
      : state.kind === "connect" && choice?.signIn !== "api-key" && choice?.signIn !== "none";
  const error = answerError ?? signIn.error;

  return (
    <View className="mb-3 gap-3 rounded-[20px] border border-border bg-card-alt p-4">
      <View className="flex-row items-start gap-3">
        <ConnectorIcon name={item.label} iconUrl={choice?.entry?.iconUrl} />
        <View className="min-w-0 flex-1 gap-1">
          <Text className="font-t3-bold text-base text-foreground">
            {state.kind === "connect" && state.reconnect
              ? `Reconnect ${item.label}`
              : `${botName} wants to use ${item.label}`}
          </Text>
          {item.reason.trim() ? (
            <Text className="font-sans text-sm leading-5 text-foreground-muted">{item.reason}</Text>
          ) : null}
          <Text className="font-sans text-xs text-foreground-muted">{copy.status}</Text>
        </View>
      </View>
      {waiting && signIn.pending !== null ? (
        <Pressable accessibilityRole="button" onPress={signIn.reopen} hitSlop={8}>
          <Text className="font-sans text-xs text-foreground-muted">
            Finish signing in to {signIn.pending.name} in the browser. Tap to open it again.
          </Text>
        </Pressable>
      ) : null}
      {signsInWithOAuth && signIn.redirect?.insecureRemote === true ? (
        <Text className="font-sans text-xs text-foreground-muted">{INSECURE_REDIRECT_WARNING}</Text>
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
      {!canManage ? (
        <Text className="font-sans text-xs text-foreground-muted">
          Only a session that can change settings here can answer this.
        </Text>
      ) : (
        <>
          {copy.action !== null ? (
            <Button
              label={copy.action}
              tone="primary"
              disabled={busy || (state.kind === "connect" && choice === null)}
              onPress={act}
              fullWidth
            />
          ) : null}
          {copy.declinable ? (
            <View className="flex-row justify-end">
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                hitSlop={8}
                className="px-1 py-1 active:opacity-60 disabled:opacity-50"
                onPress={() => void respond(connectionRequestDecline(item))}
              >
                <Text className="font-sans text-xs text-foreground-muted">Not now</Text>
              </Pressable>
            </View>
          ) : null}
        </>
      )}
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
    </View>
  );
}
