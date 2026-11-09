import { useAtomValue } from "@effect/atom-react";
import { secretVaultFailureMessage } from "@t3tools/client-runtime/secret-request";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  type EnvironmentId,
  type SecretVault,
  type SecretVaultEntry,
  SecretVaultEntryName,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { EllipsisIcon } from "lucide-react";
import { useId, useState } from "react";

import { useEnvironmentBots } from "../../state/connectors";
import type { EnvironmentPresentation } from "../../state/environments";
import { secretVaultEnvironment, useSecretVaults } from "../../state/secretVaults";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { ProjectFavicon } from "../ProjectFavicon";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { useSettingsScope } from "./SettingsScopeContext";
import { searchableSetting } from "./settingsSearch";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

const isEntryName = Schema.is(SecretVaultEntryName);

export function VaultsSettingsPanel() {
  const { environment } = useSettingsScope();
  return (
    <SettingsPageContainer>
      {environment?.connection.phase === "connected" ? (
        <EnvironmentVaults key={environment.environmentId} environment={environment} />
      ) : (
        <SettingsSection {...searchableSetting("vaults")}>
          <p className="px-4 py-3 text-sm text-muted-foreground">
            Connect an environment to manage the secrets its bots keep.
          </p>
        </SettingsSection>
      )}
    </SettingsPageContainer>
  );
}

type VaultDialog =
  | { readonly kind: "create" }
  | { readonly kind: "rename"; readonly vault: SecretVault }
  | { readonly kind: "bots"; readonly vault: SecretVault }
  | { readonly kind: "remove"; readonly vault: SecretVault }
  | { readonly kind: "add-entry"; readonly vault: SecretVault }
  | {
      readonly kind: "replace-entry";
      readonly vault: SecretVault;
      readonly entry: SecretVaultEntry;
    }
  | { readonly kind: "remove-entry"; readonly entry: SecretVaultEntry };

/** Runs a vault command and toasts its failure. */
function useVaultAction() {
  const [working, setWorking] = useState(false);
  const act = async <A, E>(title: string, run: () => Promise<AtomCommandResult<A, E>>) => {
    setWorking(true);
    const result = await run();
    setWorking(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      toastManager.add({
        type: "error",
        title,
        description: secretVaultFailureMessage(squashAtomCommandFailure(result)),
      });
    }
    return result._tag === "Success";
  };
  return { working, act };
}

function EnvironmentVaults({ environment }: { readonly environment: EnvironmentPresentation }) {
  const environmentId = environment.environmentId;
  const { vaults, loaded, error } = useSecretVaults(environmentId);
  const canManage = useAtomValue(secretVaultEnvironment.create.permissionAtom(environmentId));
  const [dialog, setDialog] = useState<VaultDialog | null>(null);
  const close = () => setDialog(null);

  return (
    <>
      {!canManage ? (
        <p className="px-3 text-xs text-muted-foreground sm:px-4">
          This session can see vaults on {environment.label} but not change them.
        </p>
      ) : null}
      {!loaded || vaults.length === 0 ? (
        <SettingsSection
          {...searchableSetting("vaults")}
          headerAction={
            <Button
              size="xs"
              variant="outline"
              disabled={!canManage}
              onClick={() => setDialog({ kind: "create" })}
            >
              New vault
            </Button>
          }
        >
          <SettingsRow
            title={
              !loaded
                ? error === null
                  ? "Loading vaults…"
                  : "Could not load vaults."
                : "No vaults yet."
            }
            description={
              !loaded
                ? (error ?? undefined)
                : "When a bot asks for a secret it needs again, you can keep it for that bot. Kept secrets live in vaults you turn on per bot."
            }
          />
        </SettingsSection>
      ) : (
        vaults.map((vault, index) => (
          <VaultSection
            key={vault.id}
            environmentId={environmentId}
            vault={vault}
            canManage={canManage}
            onDialog={setDialog}
            {...(index === 0
              ? {
                  newVault: (
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={!canManage}
                      onClick={() => setDialog({ kind: "create" })}
                    >
                      New vault
                    </Button>
                  ),
                }
              : {})}
          />
        ))
      )}
      {dialog?.kind === "create" || dialog?.kind === "rename" ? (
        <VaultNameDialog
          environmentId={environmentId}
          vault={dialog.kind === "rename" ? dialog.vault : null}
          onClose={close}
        />
      ) : null}
      {dialog?.kind === "bots" ? (
        <VaultBotsDialog
          environmentId={environmentId}
          vault={vaults.find((vault) => vault.id === dialog.vault.id) ?? dialog.vault}
          canManage={canManage}
          onClose={close}
        />
      ) : null}
      {dialog?.kind === "add-entry" || dialog?.kind === "replace-entry" ? (
        <EntryDialog
          environmentId={environmentId}
          vault={dialog.vault}
          entry={dialog.kind === "replace-entry" ? dialog.entry : null}
          onClose={close}
        />
      ) : null}
      <RemoveDialog environmentId={environmentId} dialog={dialog} onClose={close} />
    </>
  );
}

function VaultSection(props: {
  readonly environmentId: EnvironmentId;
  readonly vault: SecretVault;
  readonly canManage: boolean;
  readonly onDialog: (dialog: VaultDialog) => void;
  readonly newVault?: React.ReactNode;
}) {
  const { vault, onDialog } = props;
  const bots = useEnvironmentBots(props.environmentId).filter((bot) =>
    vault.projectIds.includes(bot.id),
  );
  return (
    <SettingsSection
      {...(props.newVault !== undefined ? searchableSetting("vaults") : {})}
      title={vault.name}
      headerAction={
        <div className="flex items-center gap-1">
          {props.newVault}
          <Menu>
            <MenuTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost-muted"
                  disabled={!props.canManage}
                  aria-label={`Actions for ${vault.name}`}
                />
              }
            >
              <EllipsisIcon className="size-3.5" />
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuItem onClick={() => onDialog({ kind: "add-entry", vault })}>
                Add secret…
              </MenuItem>
              <MenuItem onClick={() => onDialog({ kind: "bots", vault })}>Choose bots…</MenuItem>
              <MenuItem onClick={() => onDialog({ kind: "rename", vault })}>Rename</MenuItem>
              <MenuSeparator />
              <MenuItem variant="destructive" onClick={() => onDialog({ kind: "remove", vault })}>
                Delete vault…
              </MenuItem>
            </MenuPopup>
          </Menu>
        </div>
      }
    >
      <SettingsRow
        title="Bots"
        description={
          bots.length === 0
            ? "No bot can use it yet."
            : `Used by ${bots.map((bot) => bot.title).join(", ")}`
        }
        control={
          <Button
            size="xs"
            variant="ghost"
            disabled={!props.canManage}
            onClick={() => onDialog({ kind: "bots", vault })}
          >
            Choose…
          </Button>
        }
      />
      {vault.entries.map((entry) => (
        <SettingsRow
          key={entry.id}
          title={
            <span className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 truncate">{entry.label}</span>
              <code className="shrink-0 rounded bg-muted px-1 py-0.5 text-xs text-muted-foreground">
                {entry.name}
              </code>
            </span>
          }
          description={
            entry.lastUsedAt === null
              ? "Never used"
              : `Last used ${formatRelativeTimeLabel(entry.lastUsedAt)}`
          }
          control={
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    size="icon-sm"
                    variant="ghost-muted"
                    disabled={!props.canManage}
                    aria-label={`Actions for ${entry.label}`}
                  />
                }
              >
                <EllipsisIcon className="size-3.5" />
              </MenuTrigger>
              <MenuPopup align="end">
                <MenuItem onClick={() => onDialog({ kind: "replace-entry", vault, entry })}>
                  Replace value…
                </MenuItem>
                <MenuSeparator />
                <MenuItem
                  variant="destructive"
                  onClick={() => onDialog({ kind: "remove-entry", entry })}
                >
                  Remove…
                </MenuItem>
              </MenuPopup>
            </Menu>
          }
        />
      ))}
      <SettingsRow
        title={vault.entries.length === 0 ? "No secrets in this vault." : "Add a secret"}
        description={
          vault.entries.length === 0 ? "Bots can keep secrets here, or add one now." : undefined
        }
        control={
          <Button
            size="xs"
            variant="ghost"
            disabled={!props.canManage}
            onClick={() => onDialog({ kind: "add-entry", vault })}
          >
            Add…
          </Button>
        }
      />
    </SettingsSection>
  );
}

function VaultNameDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly vault: SecretVault | null;
  readonly onClose: () => void;
}) {
  const formId = useId();
  const [name, setName] = useState(props.vault?.name ?? "");
  const { working, act } = useVaultAction();
  const create = useAtomCommand(secretVaultEnvironment.create, { reportFailure: false });
  const rename = useAtomCommand(secretVaultEnvironment.rename, { reportFailure: false });
  const trimmed = name.trim();

  const save = async () => {
    if (trimmed.length === 0 || working) return;
    const { environmentId, vault } = props;
    const done =
      vault === null
        ? await act("Could not create the vault", () =>
            create({ environmentId, input: { name: trimmed } }),
          )
        : await act("Could not rename the vault", () =>
            rename({ environmentId, input: { vaultId: vault.id, name: trimmed } }),
          );
    if (done) props.onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !working) props.onClose();
      }}
    >
      <DialogPopup className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {props.vault === null ? "New vault" : `Rename ${props.vault.name}`}
          </DialogTitle>
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
              placeholder="Household"
              onChange={(event) => setName(event.target.value)}
              disabled={working}
              autoFocus
            />
          </form>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button variant="outline" disabled={working} onClick={props.onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={working || trimmed.length === 0}>
            {props.vault === null ? "Create" : "Save"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

/** Each switch saves at once, like a connection's bot picker. */
function VaultBotsDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly vault: SecretVault;
  readonly canManage: boolean;
  readonly onClose: () => void;
}) {
  const bots = useEnvironmentBots(props.environmentId);
  const setBot = useAtomCommand(secretVaultEnvironment.setBot, { reportFailure: false });
  const { act } = useVaultAction();
  const { vault } = props;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Bots that use {vault.name}</DialogTitle>
          <DialogDescription>
            These bots can ask for its secrets by name, and their commands can read them.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {bots.length === 0 ? (
            <p className="text-sm text-muted-foreground">No bots yet.</p>
          ) : (
            <ul className="grid gap-1" aria-label="Bots">
              {bots.map((bot) => (
                <li key={bot.id} className="flex items-center gap-2.5 py-1.5">
                  <ProjectFavicon project={bot} className="size-5" />
                  <span className="min-w-0 flex-1 truncate text-sm">{bot.title}</span>
                  <Switch
                    checked={vault.projectIds.includes(bot.id)}
                    disabled={!props.canManage}
                    aria-label={`Let ${bot.title} use ${vault.name}`}
                    onCheckedChange={(enabled) =>
                      void act("Could not change the bot's vaults", () =>
                        setBot({
                          environmentId: props.environmentId,
                          input: { vaultId: vault.id, projectId: bot.id, enabled },
                        }),
                      )
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button onClick={props.onClose}>Done</Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function EntryDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly vault: SecretVault;
  readonly entry: SecretVaultEntry | null;
  readonly onClose: () => void;
}) {
  const formId = useId();
  const { entry } = props;
  const [name, setName] = useState<string>(entry?.name ?? "");
  const [label, setLabel] = useState(entry?.label ?? "");
  const [value, setValue] = useState("");
  const { working, act } = useVaultAction();
  const putEntry = useAtomCommand(secretVaultEnvironment.putEntry, { reportFailure: false });
  const trimmedName = name.trim();
  const trimmedLabel = label.trim();
  const nameInvalid = trimmedName.length > 0 && !isEntryName(trimmedName);
  const ready =
    isEntryName(trimmedName) && trimmedLabel.length > 0 && value.trim().length > 0 && !working;

  const save = async () => {
    if (!ready || !isEntryName(trimmedName)) return;
    const done = await act("Could not save the secret", () =>
      putEntry({
        environmentId: props.environmentId,
        input: {
          vaultId: props.vault.id,
          name: trimmedName,
          label: trimmedLabel,
          value: value.trim(),
        },
      }),
    );
    if (done) props.onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !working) props.onClose();
      }}
    >
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {entry === null ? `Add a secret to ${props.vault.name}` : `Replace ${entry.label}`}
          </DialogTitle>
          {entry === null ? (
            <DialogDescription>
              Bots ask for it by name, like <code>home-assistant</code>.
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <DialogPanel>
          <form
            id={formId}
            className="grid gap-3"
            autoComplete="off"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            {entry === null ? (
              <div className="grid gap-1.5">
                <Label htmlFor={`${formId}-name`}>Name</Label>
                <Input
                  id={`${formId}-name`}
                  value={name}
                  maxLength={64}
                  placeholder="home-assistant"
                  aria-invalid={nameInvalid || undefined}
                  onChange={(event) => setName(event.target.value.toLowerCase())}
                  disabled={working}
                  autoFocus
                />
                {nameInvalid ? (
                  <p className="text-xs text-destructive">
                    Use lowercase letters and numbers, separated by - _ or .
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className="grid gap-1.5">
              <Label htmlFor={`${formId}-label`}>Label</Label>
              <Input
                id={`${formId}-label`}
                value={label}
                maxLength={120}
                placeholder="Home Assistant token"
                onChange={(event) => setLabel(event.target.value)}
                disabled={working}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${formId}-value`}>{entry === null ? "Value" : "New value"}</Label>
              <Input
                id={`${formId}-value`}
                // Password fields prompt to save credentials; this secret is not a login.
                type="text"
                className="[-webkit-text-security:disc]"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                data-1p-ignore
                data-lpignore="true"
                data-bwignore
                value={value}
                onChange={(event) => setValue(event.target.value)}
                disabled={working}
                autoFocus={entry !== null}
              />
            </div>
          </form>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button variant="outline" disabled={working} onClick={props.onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={!ready}>
            Save
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function RemoveDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly dialog: VaultDialog | null;
  readonly onClose: () => void;
}) {
  const { dialog, environmentId } = props;
  const remove = useAtomCommand(secretVaultEnvironment.remove, { reportFailure: false });
  const removeEntry = useAtomCommand(secretVaultEnvironment.removeEntry, { reportFailure: false });
  const { act } = useVaultAction();
  const open = dialog?.kind === "remove" || dialog?.kind === "remove-entry";
  const title =
    dialog?.kind === "remove"
      ? `Delete ${dialog.vault.name}?`
      : dialog?.kind === "remove-entry"
        ? `Remove ${dialog.entry.label}?`
        : "";
  const description =
    dialog?.kind === "remove"
      ? `Its ${dialog.vault.entries.length === 1 ? "secret is" : `${dialog.vault.entries.length} secrets are`} deleted from the server, and its bots will have to ask again.`
      : "It is deleted from the server. A bot that needs it will ask again.";

  const confirm = () => {
    props.onClose();
    if (dialog?.kind === "remove") {
      void act("Could not delete the vault", () =>
        remove({ environmentId, input: { vaultId: dialog.vault.id } }),
      );
    } else if (dialog?.kind === "remove-entry") {
      void act("Could not remove the secret", () =>
        removeEntry({ environmentId, input: { entryId: dialog.entry.id } }),
      );
    }
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) props.onClose();
      }}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
          <Button variant="destructive" onClick={confirm}>
            {dialog?.kind === "remove" ? "Delete" : "Remove"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
