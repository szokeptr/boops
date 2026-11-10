import type { EnvironmentId, RoomId } from "@t3tools/contracts";
import { useId, useState } from "react";
import { create } from "zustand";

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
import { useRoomCommands } from "./useRoomCommands";

interface RenameTarget {
  readonly environmentId: EnvironmentId;
  readonly roomId: RoomId;
  readonly title: string;
}

const useDialog = create<{ target: RenameTarget | null; session: number }>(() => ({
  target: null,
  session: 0,
}));

/** Opens Rename for a group chat. The room's menu and its sidebar row call this. */
export function openRenameRoomDialog(target: RenameTarget) {
  useDialog.setState((state) => ({ target, session: state.session + 1 }));
}

function close() {
  useDialog.setState({ target: null });
}

export function RenameRoomDialogHost() {
  const target = useDialog((state) => state.target);
  const session = useDialog((state) => state.session);
  return target === null ? null : <RenameRoomDialog key={session} target={target} />;
}

function RenameRoomDialog({ target }: { readonly target: RenameTarget }) {
  const id = useId();
  const commands = useRoomCommands(target.environmentId);
  const [title, setTitle] = useState(target.title);
  const [submitting, setSubmitting] = useState(false);
  const trimmed = title.trim();
  const submit = async () => {
    if (trimmed === "" || submitting) return;
    if (trimmed === target.title) {
      close();
      return;
    }
    setSubmitting(true);
    const renamed = await commands.rename(target.roomId, trimmed);
    setSubmitting(false);
    if (renamed) close();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogPopup className="sm:max-w-sm">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename group chat</DialogTitle>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-title`}>Name</Label>
              <Input
                id={`${id}-title`}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onFocus={(event) => event.currentTarget.select()}
                maxLength={80}
                autoComplete="off"
                autoFocus
              />
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || trimmed === ""}>
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
