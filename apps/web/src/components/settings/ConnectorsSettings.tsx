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
import type {
  ConnectorCatalogEntry,
  ConnectorConnection,
  ConnectorConnectionId,
  EnvironmentId,
} from "@t3tools/contracts";
import { EllipsisIcon, TriangleAlertIcon } from "lucide-react";
import { useId, useState } from "react";

import {
  connectorEnvironment,
  useConnectorCatalog,
  useConnectorConnections,
  useEnvironmentBots,
} from "../../state/connectors";
import type { EnvironmentPresentation } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { ConnectorIcon } from "../connectors/ConnectorIcon";
import { ConnectorKeyDialog } from "../connectors/ConnectorKeyDialog";
import { PendingSignInNote } from "../connectors/PendingSignInNote";
import { TurnOnForBotsDialog } from "../connectors/TurnOnForBotsDialog";
import { useConnectorSignIn } from "../connectors/useConnectorSignIn";
import { Alert, AlertDescription } from "../ui/alert";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { toastManager } from "../ui/toast";
import { useSettingsScope } from "./SettingsScopeContext";
import { searchableSetting } from "./settingsSearch";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

export function ConnectorsSettingsPanel() {
  const { environment } = useSettingsScope();
  return (
    <SettingsPageContainer>
      {environment?.connection.phase === "connected" ? (
        <EnvironmentConnectors key={environment.environmentId} environment={environment} />
      ) : (
        <SettingsSection {...searchableSetting("connectors")}>
          <p className="px-4 py-3 text-sm text-muted-foreground">
            Connect an environment to manage the services its bots can use.
          </p>
        </SettingsSection>
      )}
    </SettingsPageContainer>
  );
}

function EnvironmentConnectors({ environment }: { readonly environment: EnvironmentPresentation }) {
  const environmentId = environment.environmentId;
  const { connections, loaded, error } = useConnectorConnections(environmentId);
  const catalog = useConnectorCatalog(environmentId);
  const canManage = useAtomValue(connectorEnvironment.startOAuth.permissionAtom(environmentId));
  const [picked, setPicked] = useState<ConnectorConnectionId | null>(null);
  const signIn = useConnectorSignIn(environmentId, { onConnected: setPicked });
  const pending = signIn.pending;
  const finished =
    pending === null
      ? undefined
      : connections.find(
          (connection) =>
            connection.id === pending.connectionId && connection.status === "connected",
        );
  // A fresh OAuth connection offers the bot picker once the browser comes back.
  const pickerConnection =
    connections.find((connection) => connection.id === picked) ??
    (finished !== undefined && pending?.fresh === true ? finished : undefined);
  const closePicker = () => {
    setPicked(null);
    signIn.clearPending();
  };
  const busyOrReadOnly = signIn.busy || !canManage;

  return (
    <>
      {!canManage ? (
        <p className="px-3 text-xs text-muted-foreground sm:px-4">
          This session can see connections on {environment.label} but not change them.
        </p>
      ) : null}
      {pending !== null && finished === undefined ? (
        <PendingSignInNote
          name={pending.name}
          onReopen={signIn.reopen}
          onCancel={signIn.clearPending}
        />
      ) : null}
      {signIn.error !== null ? (
        <Alert variant="error">
          <TriangleAlertIcon aria-hidden />
          <AlertDescription>{signIn.error}</AlertDescription>
        </Alert>
      ) : null}
      <SettingsSection {...searchableSetting("connectors")}>
        {!loaded ? (
          <SettingsRow
            title={error === null ? "Loading connections…" : "Could not load connections."}
            description={error ?? undefined}
          />
        ) : connections.length === 0 ? (
          <SettingsRow
            title="Nothing connected yet."
            description="Connect a service from the gallery below, then turn it on for the bots that should use it."
          />
        ) : (
          connections.map((connection) => (
            <ConnectionRow
              key={connection.id}
              environmentId={environmentId}
              connection={connection}
              entry={catalog.entries.find((entry) => entry.id === connection.catalogId)}
              disabled={busyOrReadOnly}
              onSignIn={() => void signIn.signInAgain(connection)}
              onChooseBots={() => setPicked(connection.id)}
            />
          ))
        )}
      </SettingsSection>
      <ConnectorGallery
        entries={catalog.entries}
        error={catalog.error}
        connections={connections}
        disabled={busyOrReadOnly}
        insecureRedirect={signIn.redirect?.insecureRemote === true}
        onConnect={(entry) => void signIn.connect(catalogChoice(entry))}
      />
      <AddCustomConnector
        disabled={busyOrReadOnly}
        onConnect={(url) =>
          void signIn.connect({
            target: { url },
            name: hostOf(url),
            signIn: "detect",
            entry: null,
          })
        }
      />
      {signIn.keyPrompt !== null ? (
        <ConnectorKeyDialog
          prompt={signIn.keyPrompt}
          busy={signIn.busy}
          onSubmit={signIn.submitKey}
          onClose={signIn.closeKeyPrompt}
        />
      ) : null}
      {pickerConnection !== undefined ? (
        <TurnOnForBotsDialog
          environmentId={environmentId}
          connection={pickerConnection}
          onClose={closePicker}
        />
      ) : null}
    </>
  );
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

function statusBadge(connection: ConnectorConnection) {
  const variant =
    connection.status === "connected"
      ? "success"
      : connection.status === "needs_auth"
        ? "warning"
        : "error";
  return (
    <Badge variant={variant}>
      {connection.status === "connected"
        ? "Connected"
        : connection.status === "needs_auth"
          ? "Needs sign-in"
          : "Error"}
    </Badge>
  );
}

function ConnectionRow(props: {
  readonly environmentId: EnvironmentId;
  readonly connection: ConnectorConnection;
  readonly entry: ConnectorCatalogEntry | undefined;
  readonly disabled: boolean;
  readonly onSignIn: () => void;
  readonly onChooseBots: () => void;
}) {
  const { connection, environmentId } = props;
  const bots = botsUsingConnection(useEnvironmentBots(environmentId), connection.id);
  const [dialog, setDialog] = useState<"rename" | "remove" | null>(null);
  const [working, setWorking] = useState(false);
  const quiet = { reportFailure: false } as const;
  const test = useAtomCommand(connectorEnvironment.test, quiet);
  const disconnect = useAtomCommand(connectorEnvironment.disconnect, quiet);
  const remove = useAtomCommand(connectorEnvironment.remove, quiet);
  const input = { connectionId: connection.id };

  const act = async <A, E>(
    title: string,
    run: () => Promise<AtomCommandResult<A, E>>,
    success?: (value: A) => string,
  ) => {
    setWorking(true);
    const result = await run();
    setWorking(false);
    if (result._tag === "Success") {
      if (success) toastManager.add({ type: "success", title: success(result.value) });
    } else if (!isAtomCommandInterrupted(result)) {
      toastManager.add({
        type: "error",
        title,
        description: connectorFailureMessage(squashAtomCommandFailure(result)),
      });
    }
  };

  const tools =
    connection.toolCount === null
      ? null
      : `${connection.toolCount} ${connection.toolCount === 1 ? "tool" : "tools"}`;
  const usedBy =
    bots.length === 0 ? "No bot uses it yet" : `On for ${bots.map((bot) => bot.title).join(", ")}`;
  const disabled = props.disabled || working;

  return (
    <>
      <SettingsRow
        title={
          <span className="flex min-w-0 items-center gap-2.5">
            <ConnectorIcon
              name={connection.displayName}
              iconUrl={props.entry?.iconUrl}
              className="size-7"
            />
            <span className="min-w-0 truncate">{connection.displayName}</span>
            {statusBadge(connection)}
          </span>
        }
        description={[
          connection.status === "error" ? connectionStatusLabel(connection) : null,
          tools,
          usedBy,
        ]
          .filter(Boolean)
          .join(" · ")}
        control={
          <div className="flex items-center gap-1">
            {connection.status !== "connected" ? (
              <Button size="xs" variant="outline" disabled={disabled} onClick={props.onSignIn}>
                {connection.authKind === "none" ? "Try again" : "Sign in again"}
              </Button>
            ) : (
              <Button size="xs" variant="ghost" disabled={disabled} onClick={props.onChooseBots}>
                Bots…
              </Button>
            )}
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    size="icon-sm"
                    variant="ghost-muted"
                    disabled={disabled}
                    aria-label={`Actions for ${connection.displayName}`}
                  />
                }
              >
                <EllipsisIcon className="size-3.5" />
              </MenuTrigger>
              <MenuPopup align="end">
                <MenuItem onClick={() => setDialog("rename")}>Rename</MenuItem>
                <MenuItem
                  onClick={() =>
                    void act(
                      "Test failed",
                      () => test({ environmentId, input }),
                      ({ toolCount }) =>
                        `${connection.displayName} answered with ${toolCount} ${toolCount === 1 ? "tool" : "tools"}`,
                    )
                  }
                >
                  Test
                </MenuItem>
                {connection.authKind !== "none" ? (
                  <MenuItem onClick={props.onSignIn}>Sign in again</MenuItem>
                ) : null}
                <MenuItem onClick={props.onChooseBots}>Turn on for…</MenuItem>
                <MenuSeparator />
                {connection.authKind !== "none" && connection.status !== "needs_auth" ? (
                  <MenuItem
                    onClick={() =>
                      void act("Could not disconnect", () => disconnect({ environmentId, input }))
                    }
                  >
                    Disconnect
                  </MenuItem>
                ) : null}
                <MenuItem variant="destructive" onClick={() => setDialog("remove")}>
                  Remove…
                </MenuItem>
              </MenuPopup>
            </Menu>
          </div>
        }
      />
      {dialog === "rename" ? (
        <RenameConnectionDialog
          environmentId={environmentId}
          connection={connection}
          onClose={() => setDialog(null)}
        />
      ) : null}
      <AlertDialog
        open={dialog === "remove"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {connection.displayName}?</AlertDialogTitle>
            <AlertDialogDescription>
              {bots.length === 0
                ? "No bot uses it. Its sign-in is deleted from the server."
                : `It turns off for ${bots.map((bot) => bot.title).join(", ")}, and its sign-in is deleted from the server.`}{" "}
              To keep it on for its bots and only sign out, use Disconnect.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setDialog(null);
                void act("Could not remove the connection", () => remove({ environmentId, input }));
              }}
            >
              Remove
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}

function RenameConnectionDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly connection: ConnectorConnection;
  readonly onClose: () => void;
}) {
  const formId = useId();
  const [name, setName] = useState(props.connection.displayName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rename = useAtomCommand(connectorEnvironment.rename, { reportFailure: false });
  const trimmed = name.trim();

  const save = async () => {
    if (trimmed.length === 0 || busy) return;
    setBusy(true);
    const result = await rename({
      environmentId: props.environmentId,
      input: { connectionId: props.connection.id, displayName: trimmed },
    });
    setBusy(false);
    if (result._tag === "Success") props.onClose();
    else if (!isAtomCommandInterrupted(result)) {
      setError(connectorFailureMessage(squashAtomCommandFailure(result)));
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) props.onClose();
      }}
    >
      <DialogPopup className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Rename {props.connection.displayName}</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <form
            id={formId}
            className="grid gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <Label htmlFor={`${formId}-name`}>Name</Label>
            <Input
              id={`${formId}-name`}
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              disabled={busy}
              autoFocus
            />
            {error !== null ? (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            ) : null}
          </form>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button variant="outline" disabled={busy} onClick={props.onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={busy || trimmed.length === 0}>
            Save
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function ConnectorGallery(props: {
  readonly entries: ReadonlyArray<ConnectorCatalogEntry>;
  readonly error: string | null;
  readonly connections: ReadonlyArray<ConnectorConnection>;
  readonly disabled: boolean;
  readonly insecureRedirect: boolean;
  readonly onConnect: (entry: ConnectorCatalogEntry) => void;
}) {
  const [query, setQuery] = useState("");
  const shown = searchConnectorCatalog(props.entries, query);
  return (
    <SettingsSection
      {...searchableSetting("connector-gallery")}
      headerAction={
        <Input
          size="sm"
          type="search"
          className="w-44 sm:w-56"
          placeholder="Search connectors"
          aria-label="Search connectors"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      }
    >
      {props.insecureRedirect ? (
        <div className="px-3 pt-3 sm:px-4">
          <Alert variant="warning">
            <TriangleAlertIcon aria-hidden />
            <AlertDescription>{INSECURE_REDIRECT_WARNING}</AlertDescription>
          </Alert>
        </div>
      ) : null}
      {props.error !== null && props.entries.length === 0 ? (
        <SettingsRow title="Could not load the gallery." description={props.error} />
      ) : shown.length === 0 ? (
        <SettingsRow title="No connector matches." description="Add it by URL below." />
      ) : (
        <ul className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 sm:p-4 lg:grid-cols-3">
          {shown.map((entry) => {
            const count = props.connections.filter((c) => c.catalogId === entry.id).length;
            return (
              <li
                key={entry.id}
                className="flex min-w-0 flex-col gap-2 rounded-lg border border-border/60 p-3"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <ConnectorIcon name={entry.name} iconUrl={entry.iconUrl} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{entry.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {entry.auth.kind === "oauth"
                        ? "Sign in"
                        : entry.auth.kind === "api-key"
                          ? "API key"
                          : "No sign-in"}
                      {count > 0 ? ` · ${count} connected` : ""}
                    </p>
                  </div>
                </div>
                <p className="line-clamp-2 min-h-8 text-xs text-muted-foreground">
                  {entry.description}
                </p>
                <Button
                  size="xs"
                  variant={count > 0 ? "outline" : "default"}
                  disabled={props.disabled}
                  onClick={() => props.onConnect(entry)}
                  aria-label={`Connect ${entry.name}`}
                >
                  {count > 0 ? "Connect another" : "Connect"}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </SettingsSection>
  );
}

function AddCustomConnector(props: {
  readonly disabled: boolean;
  readonly onConnect: (url: string) => void;
}) {
  const formId = useId();
  const [url, setUrl] = useState("");
  const trimmed = url.trim();
  const valid = /^https?:\/\/[^\s/]+/i.test(trimmed);
  return (
    <SettingsSection {...searchableSetting("connector-custom")}>
      <form
        id={formId}
        className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid) return;
          props.onConnect(trimmed);
          setUrl("");
        }}
      >
        <Input
          className="sm:flex-1"
          type="url"
          inputMode="url"
          placeholder="https://example.com/mcp"
          aria-label="MCP server URL"
          value={url}
          spellCheck={false}
          onChange={(event) => setUrl(event.target.value)}
        />
        <Button type="submit" disabled={props.disabled || !valid}>
          Connect
        </Button>
      </form>
      <p className="px-3 pb-3 text-xs text-muted-foreground sm:px-4">
        Any remote MCP server that speaks Streamable HTTP. The server is asked how it signs in.
      </p>
    </SettingsSection>
  );
}
