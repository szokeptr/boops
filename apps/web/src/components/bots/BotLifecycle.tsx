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
  return {
    archiveBot: async (bot: BotTarget) => {
      const result = await archive({
        environmentId: bot.environmentId,
        input: { projectId: bot.projectId },
      });
      reportFailure(`Could not archive ${bot.name}`, result);
      if (result._tag === "Success") {
        toastManager.add({
          type: "success",
          title: `Archived ${bot.name}`,
          description: "Its routines are paused. Find it under Archived in the bot list.",
        });
      }
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
