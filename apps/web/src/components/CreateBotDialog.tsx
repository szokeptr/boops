import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { canCreateProjectInEnvironment } from "@t3tools/client-runtime/operations/projects";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type ModelSelection,
  type ProviderInstanceId,
  resolveEnvironmentMachineKind,
} from "@t3tools/contracts";
import type { ProjectAvatar } from "@t3tools/contracts";
import { lookFor } from "@t3tools/shared/botAvatar";
import { useNavigate } from "@tanstack/react-router";
import { useId, useState } from "react";
import { create } from "zustand";

import { useEnvironmentSettings } from "../hooks/useSettings";
import { getCustomModelOptionsByInstance } from "../modelSelection";
import { providerInstanceEntriesFor } from "../providerInstances";
import { useProjects, waitForThreadShell } from "../state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { useMemberEnvironmentIds } from "../state/members";
import { projectEnvironment } from "../state/projects";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../state/server";
import { useEnvironmentsWithScope } from "../state/session";
import { useAtomCommand } from "../state/use-atom-command";
import { buildThreadRouteParams } from "../threadRoutes";
import { BotAvatarPicker } from "./bots/BotAvatarPicker";
import { EnvironmentMachineIcon } from "./EnvironmentMachineIcon";
import { ProviderModelPicker } from "./chat/ProviderModelPicker";
import { scheduledTaskDefaultModel } from "./settings/scheduledTasksSettings.logic";
import { SETTINGS_PICKER_TRIGGER_CLASSNAME } from "./settings/settingsLayout";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";

const useDialog = create<{ open: boolean; session: number }>(() => ({ open: false, session: 0 }));

/** Opens the New bot dialog. Every entry point (palette, shortcut, Add bot) calls this. */
export function openCreateBotDialog() {
  useDialog.setState((state) => ({ open: true, session: state.session + 1 }));
}

function close() {
  useDialog.setState({ open: false });
}

export function CreateBotDialogHost() {
  const open = useDialog((state) => state.open);
  const session = useDialog((state) => state.session);
  return open ? <CreateBotDialog key={session} /> : null;
}

interface BotEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly machine: ReturnType<typeof resolveEnvironmentMachineKind>;
}

/** Connected machines this client may create bots on, the primary one first. */
function useBotEnvironments(): readonly BotEnvironment[] {
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const canOperate = useEnvironmentsWithScope(environments, AuthOrchestrationOperateScope);
  // A member operates threads on someone else's machine but never creates bots there.
  const memberEnvironmentIds = useMemberEnvironmentIds(
    environments.map((environment) => environment.environmentId),
  );
  return environments
    .filter(
      (environment) =>
        canOperate.has(environment.environmentId) &&
        !memberEnvironmentIds.has(environment.environmentId) &&
        canCreateProjectInEnvironment(environment.connection.phase) &&
        environment.serverConfig !== null,
    )
    .map((environment) => ({
      environmentId: environment.environmentId,
      label: environment.label,
      machine: resolveEnvironmentMachineKind(environment.serverConfig),
    }))
    .toSorted(
      (a, b) =>
        Number(b.environmentId === primaryEnvironmentId) -
          Number(a.environmentId === primaryEnvironmentId) || a.label.localeCompare(b.label),
    );
}

function CreateBotDialog() {
  const environments = useBotEnvironments();
  const [pickedEnvironmentId, setPickedEnvironmentId] = useState<EnvironmentId | null>(null);
  const [name, setName] = useState("");
  const environment =
    environments.find((entry) => entry.environmentId === pickedEnvironmentId) ??
    environments[0] ??
    null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogPopup className="sm:max-w-md">
        {environment ? (
          <CreateBotForm
            key={environment.environmentId}
            environment={environment}
            environments={environments}
            onEnvironmentChange={setPickedEnvironmentId}
            name={name}
            onNameChange={setName}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>New bot</DialogTitle>
              <DialogDescription>
                Connect to a machine first. A bot lives on the machine that runs it.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                Close
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogPopup>
    </Dialog>
  );
}

function CreateBotForm({
  environment,
  environments,
  onEnvironmentChange,
  name,
  onNameChange: setName,
}: {
  environment: BotEnvironment;
  environments: readonly BotEnvironment[];
  onEnvironmentChange: (environmentId: EnvironmentId) => void;
  name: string;
  onNameChange: (name: string) => void;
}) {
  const id = useId();
  const navigate = useNavigate();
  const { environmentId } = environment;
  const createBot = useAtomCommand(projectEnvironment.createBot, { reportFailure: false });
  const settings = useEnvironmentSettings(environmentId);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const instanceEntries = providerInstanceEntriesFor(providers, settings, null);
  const [pickedModel, setPickedModel] = useState<ModelSelection | null>(null);
  const modelSelection = pickedModel ?? scheduledTaskDefaultModel(settings, null, instanceEntries);
  const modelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    providers,
    modelSelection?.instanceId,
    modelSelection?.model,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Null until the user rerolls or overrides; the server then picks a look siblings don't use.
  const [avatar, setAvatar] = useState<ProjectAvatar | null>(null);
  const siblings = useProjects()
    .filter((project) => project.environmentId === environmentId && !project.isScratch)
    .map((project) => lookFor(project.avatar, project.title));

  const submit = async () => {
    const trimmed = name.trim();
    if (submitting || trimmed.length === 0 || modelSelection === null) return;
    setSubmitting(true);
    setError(null);
    const result = await createBot({
      environmentId,
      input: { name: trimmed, modelSelection, ...(avatar === null ? {} : { avatar }) },
    });
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const cause = squashAtomCommandFailure(result);
        setError(cause instanceof Error ? cause.message : "Could not create the bot.");
      }
      setSubmitting(false);
      return;
    }
    const threadRef = scopeThreadRef(environmentId, result.value.mainThreadId);
    // The route treats a thread it has not heard of as missing, so let the shell arrive first.
    await waitForThreadShell(threadRef);
    close();
    await navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(threadRef) });
  };

  return (
    <form
      className="flex min-h-0 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>New bot</DialogTitle>
        <DialogDescription>
          Give it a name and a model. It will introduce itself and ask you a few questions.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <BotAvatarPicker
          name={name.trim() || "New bot"}
          value={avatar}
          siblings={siblings}
          onChange={setAvatar}
        />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-name`}>Name</Label>
          <Input
            id={`${id}-name`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={200}
            autoFocus
            autoComplete="off"
            placeholder="Ada"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Model</Label>
          <div>
            <ProviderModelPicker
              environmentId={environmentId}
              disabled={submitting}
              activeInstanceId={
                modelSelection?.instanceId ??
                instanceEntries[0]?.instanceId ??
                ("" as ProviderInstanceId)
              }
              model={modelSelection?.model ?? ""}
              lockedProvider={null}
              instanceEntries={instanceEntries}
              modelOptionsByInstance={modelOptionsByInstance}
              isComposerOwned={false}
              triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
              onInstanceModelChange={(instanceId, model) => setPickedModel({ instanceId, model })}
            />
          </div>
        </div>
        {environments.length > 1 ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-environment`}>Lives on</Label>
            <Select
              value={environmentId}
              disabled={submitting}
              onValueChange={(value) => {
                const next = environments.find((entry) => entry.environmentId === value);
                if (next) onEnvironmentChange(next.environmentId);
              }}
              items={environments.map((entry) => ({
                value: entry.environmentId,
                label: entry.label,
              }))}
            >
              <SelectTrigger id={`${id}-environment`} size="sm" aria-label="Machine">
                <EnvironmentMachineIcon kind={environment.machine} className="size-3.5" />
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {environments.map((entry) => (
                  <SelectItem key={entry.environmentId} value={entry.environmentId}>
                    <span className="inline-flex items-center gap-1.5">
                      <EnvironmentMachineIcon kind={entry.machine} className="size-3" />
                      {entry.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
        ) : null}
        {modelSelection === null ? (
          <p className="text-muted-foreground text-sm">
            No model is available on {environment.label}. Sign in to a provider in Settings first.
          </p>
        ) : null}
        {error ? <p className="text-destructive-foreground text-sm">{error}</p> : null}
      </DialogPanel>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={close}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={submitting || name.trim().length === 0 || modelSelection === null}
        >
          {submitting ? "Creating…" : "Create bot"}
        </Button>
      </DialogFooter>
    </form>
  );
}
