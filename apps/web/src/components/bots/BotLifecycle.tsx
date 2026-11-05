import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useId, useState } from "react";
import { create } from "zustand";

import { liveBotDescendants } from "@t3tools/client-runtime/state/bot-list";
import { useProjects } from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
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
import { stackedThreadToast, toastManager } from "../ui/toast";

export interface BotTarget {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly name: string;
}

function reportFailure(title: string, result: AtomCommandResult<unknown, unknown>) {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
  const error = squashAtomCommandFailure(result);
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}

/** Whether this connection may archive, unarchive and delete bots on the environment. */
export function useCanManageBot(environmentId: EnvironmentId | null): boolean {
  return useAtomValue(projectEnvironment.archiveBot.permissionAtom(environmentId));
}

/** Archive and Unarchive for every entry point: settings, the palette and the Archived list. */
export function useBotArchive() {
  const archive = useAtomCommand(projectEnvironment.archiveBot, { reportFailure: false });
  const unarchive = useAtomCommand(projectEnvironment.unarchiveBot, { reportFailure: false });
  const projects = useProjects();
  const runArchive = async (bot: BotTarget, includeChildren: boolean) => {
    const result = await archive({
      environmentId: bot.environmentId,
      input: { projectId: bot.projectId, ...(includeChildren ? { includeChildren } : {}) },
    });
    reportFailure(`Could not archive ${bot.name}`, result);
    if (result._tag === "Success") {
      const others = result.value.projectIds.length - 1;
      toastManager.add({
        type: "success",
        title:
          others === 0
            ? `Archived ${bot.name}`
            : `Archived ${bot.name} and ${others} ${others === 1 ? "bot" : "bots"} it created`,
        description: "Routines are paused. Find archived bots under Archived in the bot list.",
      });
    }
    return result._tag === "Success";
  };
  return {
    runArchive,
    /** A bot with live child bots asks whether they go too; one without archives at once. */
    archiveBot: async (bot: BotTarget) => {
      const children = liveBotDescendants(projects, bot).length;
      if (children > 0) {
        useArchiveDialog.setState((state) => ({
          request: { bot, children },
          session: state.session + 1,
        }));
        return;
      }
      await runArchive(bot, false);
    },
    unarchiveBot: async (bot: BotTarget) => {
      const result = await unarchive({
        environmentId: bot.environmentId,
        input: { projectId: bot.projectId },
      });
      reportFailure(`Could not unarchive ${bot.name}`, result);
    },
  };
}

const useArchiveDialog = create<{
  request: { readonly bot: BotTarget; readonly children: number } | null;
  session: number;
}>(() => ({ request: null, session: 0 }));

function closeArchiveDialog() {
  useArchiveDialog.setState({ request: null });
}

export function ArchiveBotDialogHost() {
  const request = useArchiveDialog((state) => state.request);
  const session = useArchiveDialog((state) => state.session);
  return request ? (
    <ArchiveBotDialog key={session} bot={request.bot} childCount={request.children} />
  ) : null;
}

function ArchiveBotDialog({
  bot,
  childCount,
}: {
  readonly bot: BotTarget;
  readonly childCount: number;
}) {
  const { runArchive } = useBotArchive();
  const [includeChildren, setIncludeChildren] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    if (await runArchive(bot, includeChildren)) closeArchiveDialog();
    else setSubmitting(false);
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeArchiveDialog();
      }}
    >
      <DialogPopup className="sm:max-w-md">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Archive {bot.name}?</DialogTitle>
            <DialogDescription>
              Pauses its routines and heartbeat and moves it out of the bot list. Its conversation
              and home folder are kept, and you can unarchive it any time.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <Checkbox
                checked={includeChildren}
                onCheckedChange={(checked) => setIncludeChildren(checked === true)}
              />
              <span className="flex flex-col gap-0.5">
                <span>
                  Also archive the {childCount === 1 ? "bot" : `${childCount} bots`} it created
                </span>
                <span className="text-muted-foreground text-xs">
                  Off leaves them running on their own.
                </span>
              </span>
            </label>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeArchiveDialog}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              Archive
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

const useDeleteDialog = create<{ bot: BotTarget | null; session: number }>(() => ({
  bot: null,
  session: 0,
}));

/** Opens the Delete bot dialog, which asks for the bot's name before deleting. */
export function openDeleteBotDialog(bot: BotTarget) {
  useDeleteDialog.setState((state) => ({ bot, session: state.session + 1 }));
}

function closeDeleteDialog() {
  useDeleteDialog.setState({ bot: null });
}

export function DeleteBotDialogHost() {
  const bot = useDeleteDialog((state) => state.bot);
  const session = useDeleteDialog((state) => state.session);
  return bot ? <DeleteBotDialog key={session} bot={bot} /> : null;
}

function DeleteBotDialog({ bot }: { readonly bot: BotTarget }) {
  const id = useId();
  const navigate = useNavigate();
  const deleteBot = useAtomCommand(projectEnvironment.deleteBot, { reportFailure: false });
  const [typedName, setTypedName] = useState("");
  const [removeHomeFolder, setRemoveHomeFolder] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmed = typedName.trim() === bot.name.trim();

  const submit = async () => {
    if (!confirmed || submitting) return;
    setSubmitting(true);
    setError(null);
    const result = await deleteBot({
      environmentId: bot.environmentId,
      input: { projectId: bot.projectId, ...(removeHomeFolder ? { removeHomeFolder } : {}) },
    });
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const cause = squashAtomCommandFailure(result);
        setError(cause instanceof Error ? cause.message : "Could not delete the bot.");
      }
      setSubmitting(false);
      return;
    }
    closeDeleteDialog();
    toastManager.add({ type: "success", title: `Deleted ${bot.name}` });
    await navigate({ to: "/" });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeDeleteDialog();
      }}
    >
      <DialogPopup className="sm:max-w-md">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Delete {bot.name}?</DialogTitle>
            <DialogDescription>
              Deletes its conversation, threads and routines. This cannot be undone. Archive it
              instead to keep everything and pause it.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-name`}>
                Type <span className="font-semibold">{bot.name}</span> to confirm
              </Label>
              <Input
                id={`${id}-name`}
                autoFocus
                autoComplete="off"
                value={typedName}
                onChange={(event) => setTypedName(event.target.value)}
              />
            </div>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <Checkbox
                checked={removeHomeFolder}
                onCheckedChange={(checked) => setRemoveHomeFolder(checked === true)}
              />
              <span className="flex flex-col gap-0.5">
                <span>Also delete its home folder</span>
                <span className="text-muted-foreground text-xs">
                  Removes its files and memory from ~/pocks on its machine. Off keeps the folder.
                </span>
              </span>
            </label>
            {error ? <p className="text-destructive-foreground text-sm">{error}</p> : null}
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeDeleteDialog}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={!confirmed || submitting}>
              Delete bot
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
