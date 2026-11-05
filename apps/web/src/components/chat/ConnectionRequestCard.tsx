import { useAtomValue } from "@effect/atom-react";
import {
  type ConnectionRequestItem,
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
import type { EnvironmentId, OrchestrationV2ProjectedTurnItem } from "@t3tools/contracts";
import { CheckIcon, MinusIcon, PlugIcon, XIcon } from "lucide-react";
import { useState } from "react";

import {
  connectorEnvironment,
  useConnectorCatalog,
  useConnectorConnections,
} from "../../state/connectors";
import { useProject, useThreadShell } from "../../state/entities";
import { useAtomCommand } from "../../state/use-atom-command";
import { ConnectorIcon } from "../connectors/ConnectorIcon";
import { ConnectorKeyDialog } from "../connectors/ConnectorKeyDialog";
import { useConnectorSignIn } from "../connectors/useConnectorSignIn";
import { useSetBotConnection } from "../connectors/useSetBotConnection";
import { Button } from "../ui/button";
import { WorkLogRow } from "./WorkLog";

/**
 * A bot asked for a connector. The card's record closes once answered; what it shows comes
 * from the live connections and the bot's `connectionIds`, so it follows later changes.
 */
export function ConnectionRequestCard(props: {
  readonly environmentId: EnvironmentId;
  readonly item: ConnectionRequestItem;
  readonly visibility: OrchestrationV2ProjectedTurnItem["visibility"];
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
  const iconUrl = choice?.entry?.iconUrl;

  if (
    state.kind === "connected" ||
    state.kind === "declined" ||
    state.kind === "ended" ||
    state.kind === "failed" ||
    state.kind === "waiting-elsewhere"
  ) {
    const Icon =
      state.kind === "connected"
        ? CheckIcon
        : state.kind === "failed"
          ? XIcon
          : state.kind === "waiting-elsewhere"
            ? PlugIcon
            : MinusIcon;
    return (
      <WorkLogRow
        data-v2-item-type={item.type}
        data-connection-state={state.kind}
        icon={<Icon className="size-3.5 text-icon-muted" aria-hidden />}
        label={state.kind === "connected" ? copy.status : `${item.label} · ${copy.status}`}
      />
    );
  }

  const respond = async (input: Parameters<typeof answer>[0]["input"]) => {
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
        return;
    }
  };

  const busy = answering || signIn.busy;
  const waiting =
    signIn.pending !== null &&
    !connections.some(
      (connection) =>
        connection.id === signIn.pending?.connectionId && connection.status === "connected",
    );
  const signsInWithOAuth =
    state.kind === "sign-in"
      ? state.connection.authKind === "oauth"
      : state.kind === "connect" && choice?.signIn !== "api-key" && choice?.signIn !== "none";
  const error = answerError ?? signIn.error;

  return (
    <div
      data-v2-item-type={item.type}
      data-connection-state={state.kind}
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-border/60 bg-card p-4"
    >
      <div className="flex min-w-0 items-start gap-3">
        <ConnectorIcon name={item.label} iconUrl={iconUrl} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-sm font-medium text-foreground">
            {state.kind === "connect" && state.reconnect
              ? `Reconnect ${item.label}`
              : `${botName} wants to use ${item.label}`}
          </p>
          {item.reason.trim() ? (
            <p className="text-sm text-muted-foreground">{item.reason}</p>
          ) : null}
          <p className="text-xs text-muted-foreground/80">{copy.status}</p>
        </div>
      </div>
      {waiting && signIn.pending !== null ? (
        <p className="text-xs text-muted-foreground">
          Finish signing in to {signIn.pending.name} in the browser.{" "}
          <Button type="button" size="xs" variant="link" onClick={signIn.reopen}>
            Open it again
          </Button>
        </p>
      ) : null}
      {signsInWithOAuth && signIn.redirect?.insecureRemote === true ? (
        <p className="text-xs text-warning-foreground">{INSECURE_REDIRECT_WARNING}</p>
      ) : null}
      {error !== null ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {!canManage ? (
        <p className="text-xs text-muted-foreground">
          Only a session that can change settings here can answer this.
        </p>
      ) : (
        <div className="flex min-w-0 items-center justify-end gap-2">
          {copy.declinable ? (
            <Button
              type="button"
              size="xs"
              variant="ghost-muted"
              disabled={busy}
              onClick={() => void respond(connectionRequestDecline(item))}
            >
              Not now
            </Button>
          ) : null}
          {copy.action !== null ? (
            <Button
              type="button"
              size="xs"
              disabled={busy || (state.kind === "connect" && choice === null)}
              onClick={act}
            >
              {copy.action}
            </Button>
          ) : null}
        </div>
      )}
      {signIn.keyPrompt !== null ? (
        <ConnectorKeyDialog
          prompt={signIn.keyPrompt}
          busy={signIn.busy}
          onSubmit={signIn.submitKey}
          onClose={signIn.closeKeyPrompt}
        />
      ) : null}
    </div>
  );
}
