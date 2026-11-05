import { type ConnectorChoice, connectorFailureMessage } from "@t3tools/client-runtime/connectors";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  ConnectorConnection,
  ConnectorConnectionId,
  ConnectorRequestRef,
  EnvironmentId,
} from "@t3tools/contracts";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import {
  connectorEnvironment,
  useConnectorConnections,
  useConnectorRedirect,
} from "../../state/connectors";
import { useAtomCommand } from "../../state/use-atom-command";

/** A sign-in waiting on the browser; the subscribe stream says when it lands. */
export interface PendingConnectorSignIn {
  readonly connectionId: ConnectorConnectionId;
  readonly name: string;
  readonly authorizationUrl: string;
  /** A new connection, as opposed to signing an existing one in again. */
  readonly fresh: boolean;
}

export type ConnectorKeyPrompt =
  | { readonly kind: "new"; readonly choice: ConnectorChoice }
  | { readonly kind: "reauthenticate"; readonly connection: ConnectorConnection };

/** The system's auth browser, else the default browser. */
const openAuthPage = async (url: string) => {
  try {
    await WebBrowser.openBrowserAsync(url, { createTask: false });
  } catch {
    await tryOpenExternalUrl(url, "provider-auth");
  }
};

const settle = <A, E>(result: AtomCommandResult<A, E>, fallback: string) =>
  result._tag === "Success"
    ? ({ ok: true, value: result.value } as const)
    : ({
        ok: false,
        message: isAtomCommandInterrupted(result)
          ? null
          : connectorFailureMessage(squashAtomCommandFailure(result), fallback),
      } as const);

/**
 * Connecting and signing in again, shared by Settings and the thread card; web's hook of the
 * same name follows the same rules. Android's Custom Tabs never close themselves, so completion
 * always comes from the subscribe stream.
 */
export function useConnectorSignIn(
  environmentId: EnvironmentId,
  options: {
    readonly forRequest?: ConnectorRequestRef;
    readonly onConnected?: (connectionId: ConnectorConnectionId) => void;
  } = {},
) {
  const redirect = useConnectorRedirect(environmentId);
  const { connections } = useConnectorConnections(environmentId);
  const [pending, setPending] = useState<PendingConnectorSignIn | null>(null);
  const [keyPrompt, setKeyPrompt] = useState<ConnectorKeyPrompt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const quiet = { reportFailure: false, reportDefect: false } as const;
  const detectAuth = useAtomCommand(connectorEnvironment.detectAuth, quiet);
  const startOAuth = useAtomCommand(connectorEnvironment.startOAuth, quiet);
  const addConnection = useAtomCommand(connectorEnvironment.addConnection, quiet);
  const reauthenticate = useAtomCommand(connectorEnvironment.reauthenticate, quiet);
  const test = useAtomCommand(connectorEnvironment.test, quiet);
  const forRequest = options.forRequest === undefined ? {} : { forRequest: options.forRequest };

  const finished =
    pending !== null &&
    connections.some(
      (connection) => connection.id === pending.connectionId && connection.status === "connected",
    );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- closes the native auth browser once the server reports the sign-in
  useEffect(() => {
    if (finished && Platform.OS === "ios") WebBrowser.dismissBrowser();
  }, [finished]);

  const run = async (work: () => Promise<string | null>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const failure = await work();
    inFlight.current = false;
    setBusy(false);
    setError(failure);
  };

  const oauth = async (
    name: string,
    fresh: boolean,
    begin: (
      redirectOrigin: string,
    ) => Promise<
      | { readonly ok: true; readonly connectionId: ConnectorConnectionId; readonly url: string }
      | { readonly ok: false; readonly message: string | null }
    >,
  ) => {
    if (redirect === null) {
      return "This app has no address for the server to send sign-ins back to. Reconnect and try again.";
    }
    const started = await begin(redirect.origin);
    if (!started.ok) return started.message;
    setPending({ connectionId: started.connectionId, name, authorizationUrl: started.url, fresh });
    void openAuthPage(started.url);
    return null;
  };

  const connect = (choice: ConnectorChoice) =>
    run(async () => {
      let signIn = choice.signIn;
      if (signIn === "detect" && "url" in choice.target) {
        const detected = settle(
          await detectAuth({ environmentId, input: { url: choice.target.url } }),
          "Could not reach that server.",
        );
        if (!detected.ok) return detected.message;
        signIn = detected.value.authKind;
      }
      if (signIn === "api-key") {
        setKeyPrompt({ kind: "new", choice });
        return null;
      }
      if (signIn === "none" || signIn === "detect") {
        const result = settle(
          await addConnection({
            environmentId,
            input: { target: choice.target, credential: { type: "none" }, ...forRequest },
          }),
          "Could not add the connection.",
        );
        if (!result.ok) return result.message;
        options.onConnected?.(result.value.id);
        return null;
      }
      return oauth(choice.name, true, async (redirectOrigin) => {
        const result = settle(
          await startOAuth({
            environmentId,
            input: { target: choice.target, redirectOrigin, ...forRequest },
          }),
          "Could not start signing in.",
        );
        return result.ok
          ? {
              ok: true,
              connectionId: result.value.connectionId,
              url: result.value.authorizationUrl,
            }
          : result;
      });
    });

  const signInAgain = (connection: ConnectorConnection) => {
    if (connection.authKind === "api-key") {
      setError(null);
      setKeyPrompt({ kind: "reauthenticate", connection });
      return Promise.resolve();
    }
    if (connection.authKind === "none") {
      return run(async () => {
        const result = settle(
          await test({ environmentId, input: { connectionId: connection.id } }),
          "The server did not answer.",
        );
        return result.ok ? null : result.message;
      });
    }
    return run(() =>
      oauth(connection.displayName, false, async (redirectOrigin) => {
        const result = settle(
          await reauthenticate({
            environmentId,
            input: {
              connectionId: connection.id,
              credential: { type: "oauth", redirectOrigin },
              ...forRequest,
            },
          }),
          "Could not start signing in.",
        );
        if (!result.ok) return result;
        if (result.value.authorizationUrl === null) {
          return { ok: false, message: "The server did not return a sign-in page." };
        }
        return { ok: true, connectionId: connection.id, url: result.value.authorizationUrl };
      }),
    );
  };

  /** Settles to an error to show in the key sheet, or null once the key is saved. */
  const submitKey = async (apiKey: string, headerName?: string): Promise<string | null> => {
    const prompt = keyPrompt;
    if (prompt === null || inFlight.current) return null;
    inFlight.current = true;
    setBusy(true);
    const saved =
      prompt.kind === "new"
        ? settle(
            await addConnection({
              environmentId,
              input: {
                target: prompt.choice.target,
                credential: {
                  type: "api-key",
                  apiKey,
                  ...(headerName === undefined ? {} : { headerName }),
                },
                ...forRequest,
              },
            }),
            "Could not save the key.",
          )
        : settle(
            await reauthenticate({
              environmentId,
              input: {
                connectionId: prompt.connection.id,
                credential: { type: "api-key", apiKey },
                ...forRequest,
              },
            }),
            "Could not save the key.",
          );
    inFlight.current = false;
    setBusy(false);
    if (!saved.ok) return saved.message ?? "Could not save the key.";
    setKeyPrompt(null);
    const connectionId =
      prompt.kind === "reauthenticate"
        ? prompt.connection.id
        : "id" in saved.value
          ? saved.value.id
          : null;
    if (connectionId !== null) options.onConnected?.(connectionId);
    return null;
  };

  return {
    redirect,
    pending,
    /** The pending sign-in landed. */
    finished,
    clearPending: () => setPending(null),
    reopen: () => {
      if (pending !== null) void openAuthPage(pending.authorizationUrl);
    },
    keyPrompt,
    closeKeyPrompt: () => setKeyPrompt(null),
    busy,
    error,
    connect,
    signInAgain,
    submitKey,
  };
}
