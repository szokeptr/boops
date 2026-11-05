import {
  type ConnectorChoice,
  connectorCallbackUrl,
  connectorFailureMessage,
  isOAuthClientRequired,
} from "@t3tools/client-runtime/connectors";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  ConnectorCatalogEntry,
  ConnectorConnection,
  ConnectorConnectionId,
  ConnectorOAuthClientInput,
  ConnectorRequestRef,
  EnvironmentId,
} from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import {
  connectorEnvironment,
  useConnectorCatalog,
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

/** An OAuth client the user still has to create, for a server without client registration. */
export type ConnectorClientPrompt = ConnectorKeyPrompt & {
  readonly name: string;
  readonly entry: ConnectorCatalogEntry | null;
  readonly redirectUri: string;
};

// Loaded on first sign-in, so the thread feed doesn't load the native browser module up front.
const webBrowser = () => import("expo-web-browser");

/** The system's auth browser, else the default browser. */
const openAuthPage = async (url: string) => {
  try {
    await (await webBrowser()).openBrowserAsync(url, { createTask: false });
  } catch {
    await tryOpenExternalUrl(url, "provider-auth");
  }
};

/** A new connection's id; signing in again answers without one. */
const connectionIdOf = (value: object): ConnectorConnectionId | null =>
  "connectionId" in value ? (value.connectionId as ConnectorConnectionId) : null;

const settle = <A, E>(result: AtomCommandResult<A, E>, fallback: string) =>
  result._tag === "Success"
    ? ({ ok: true, value: result.value } as const)
    : ({
        ok: false,
        message: isAtomCommandInterrupted(result)
          ? null
          : connectorFailureMessage(squashAtomCommandFailure(result), fallback),
        clientRequired: isOAuthClientRequired(squashAtomCommandFailure(result)),
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
  const catalog = useConnectorCatalog(environmentId).entries;
  const [pending, setPending] = useState<PendingConnectorSignIn | null>(null);
  const [keyPrompt, setKeyPrompt] = useState<ConnectorKeyPrompt | null>(null);
  const [clientPrompt, setClientPrompt] = useState<ConnectorClientPrompt | null>(null);
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
    if (finished && Platform.OS === "ios") {
      void webBrowser().then((browser) => browser.dismissBrowser());
    }
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

  /** Starts a sign-in, or asks for an OAuth client when the server has no way to register one. */
  const oauth = async (
    target: ConnectorKeyPrompt,
    client?: ConnectorOAuthClientInput,
  ): Promise<string | null> => {
    if (redirect === null) {
      return "This app has no address for the server to send sign-ins back to. Reconnect and try again.";
    }
    const redirectOrigin = redirect.origin;
    const withClient = client === undefined ? {} : { client };
    const fallback = "Could not start signing in.";
    const started =
      target.kind === "new"
        ? settle(
            await startOAuth({
              environmentId,
              input: { target: target.choice.target, redirectOrigin, ...withClient, ...forRequest },
            }),
            fallback,
          )
        : settle(
            await reauthenticate({
              environmentId,
              input: {
                connectionId: target.connection.id,
                credential: { type: "oauth", redirectOrigin, ...withClient },
                ...forRequest,
              },
            }),
            fallback,
          );
    const name = target.kind === "new" ? target.choice.name : target.connection.displayName;
    if (!started.ok) {
      if (!started.clientRequired || client !== undefined) return started.message;
      const entry =
        target.kind === "new"
          ? target.choice.entry
          : (catalog.find((candidate) => candidate.id === target.connection.catalogId) ?? null);
      setClientPrompt({
        ...target,
        name,
        entry,
        redirectUri: connectorCallbackUrl(redirectOrigin),
      });
      return null;
    }
    const connectionId =
      target.kind === "reauthenticate" ? target.connection.id : connectionIdOf(started.value);
    const url = started.value.authorizationUrl;
    if (connectionId === null || url === null) return "The server did not return a sign-in page.";
    setPending({ connectionId, name, authorizationUrl: url, fresh: target.kind === "new" });
    void openAuthPage(url);
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
      return oauth({ kind: "new", choice });
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
    return run(() => oauth({ kind: "reauthenticate", connection }));
  };

  /** Settles to an error to show in the client sheet, or null once the sign-in page opens. */
  const submitClient = async (client: ConnectorOAuthClientInput): Promise<string | null> => {
    const prompt = clientPrompt;
    if (prompt === null || inFlight.current) return null;
    inFlight.current = true;
    setBusy(true);
    const failure = await oauth(prompt, client);
    inFlight.current = false;
    setBusy(false);
    if (failure === null) setClientPrompt(null);
    return failure;
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
    clientPrompt,
    closeClientPrompt: () => setClientPrompt(null),
    submitClient,
    busy,
    error,
    connect,
    signInAgain,
    submitKey,
  };
}
