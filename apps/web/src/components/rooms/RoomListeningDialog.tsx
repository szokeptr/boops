import { useAtomValue } from "@effect/atom-react";
import {
  type EnvironmentId,
  type ProjectId,
  ROOM_LISTENS_FOR_MAX_LENGTH,
  type RoomId,
} from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";
import { create } from "zustand";

import { memberEnvironment } from "../../state/members";
import { useRoom } from "../../state/rooms";
import { Alert, AlertDescription } from "../ui/alert";
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
import { Switch } from "../ui/switch";
import { useRoomCommands } from "./useRoomCommands";

interface ListeningTarget {
  readonly environmentId: EnvironmentId;
  readonly roomId: RoomId;
}

const useDialog = create<{ target: ListeningTarget | null; session: number }>(() => ({
  target: null,
  session: 0,
}));

/** Opens the settings for which bots in a group chat chime in without an @mention. */
export function openRoomListeningDialog(target: ListeningTarget) {
  useDialog.setState((state) => ({ target, session: state.session + 1 }));
}

function close() {
  useDialog.setState({ target: null });
}

export function RoomListeningDialogHost() {
  const target = useDialog((state) => state.target);
  const session = useDialog((state) => state.session);
  return target === null ? null : <RoomListeningDialog key={session} target={target} />;
}

interface Draft {
  readonly listening: boolean;
  readonly listensFor: string;
}

function RoomListeningDialog({ target }: { readonly target: ListeningTarget }) {
  const id = useId();
  const { room, canListen } = useRoom(target.environmentId, target.roomId);
  const isOwner = useAtomValue(memberEnvironment.sessionMemberAtom(target.environmentId)) === null;
  const commands = useRoomCommands(target.environmentId);
  const [drafts, setDrafts] = useState<ReadonlyMap<ProjectId, Draft>>(new Map());
  const [saving, setSaving] = useState(false);

  const bots = (room?.participants ?? []).flatMap((entry) =>
    entry.participant.kind === "bot"
      ? [
          {
            projectId: entry.participant.projectId,
            name: entry.name,
            saved: {
              listening: entry.listening ?? false,
              listensFor: entry.listensFor ?? "",
            } satisfies Draft,
          },
        ]
      : [],
  );
  const draftOf = (bot: (typeof bots)[number]) => drafts.get(bot.projectId) ?? bot.saved;
  const edit = (bot: (typeof bots)[number], change: Partial<Draft>) =>
    setDrafts((current) => new Map(current).set(bot.projectId, { ...draftOf(bot), ...change }));
  const changed = bots.filter((bot) => {
    const draft = draftOf(bot);
    return (
      draft.listening !== bot.saved.listening ||
      draft.listensFor.trim() !== bot.saved.listensFor.trim()
    );
  });

  const save = async () => {
    if (saving) return;
    setSaving(true);
    let ok = true;
    for (const bot of changed) {
      const draft = draftOf(bot);
      const listensFor = draft.listensFor.trim();
      ok =
        (await commands.setListening(
          target.roomId,
          bot.projectId,
          draft.listening,
          listensFor === "" ? null : listensFor,
        )) && ok;
    }
    setSaving(false);
    if (ok) close();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogPopup className="sm:max-w-md">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <DialogHeader>
            <DialogTitle>Bots chiming in</DialogTitle>
            <DialogDescription>
              A bot that chimes in may answer without an @mention when the chat is about something
              it can help with, or follows up on what it said. It stays quiet otherwise.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-5">
              {canListen ? null : (
                <Alert>
                  <AlertDescription>
                    {isOwner ? (
                      <span>
                        This needs an OpenAI API key.{" "}
                        <Link className="underline" to="/settings/providers" onClick={close}>
                          Add one in Providers settings
                        </Link>
                        .
                      </span>
                    ) : (
                      "The owner of this machine hasn't set this up yet. Until then, bots answer only when @mentioned."
                    )}
                  </AlertDescription>
                </Alert>
              )}
              {bots.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  There are no bots in this group chat.
                </p>
              ) : (
                bots.map((bot) => {
                  const draft = draftOf(bot);
                  return (
                    <div key={bot.projectId} className="flex flex-col gap-2">
                      <div className="flex items-center justify-between gap-3">
                        <Label htmlFor={`${id}-${bot.projectId}-switch`}>{bot.name}</Label>
                        <Switch
                          id={`${id}-${bot.projectId}-switch`}
                          checked={draft.listening}
                          onCheckedChange={(listening) => edit(bot, { listening })}
                        />
                      </div>
                      {draft.listening ? (
                        <Input
                          aria-label={`What ${bot.name} is here for`}
                          placeholder="Here for… (optional), e.g. flights and hotels"
                          value={draft.listensFor}
                          maxLength={ROOM_LISTENS_FOR_MAX_LENGTH}
                          onChange={(event) => edit(bot, { listensFor: event.target.value })}
                          autoComplete="off"
                        />
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || changed.length === 0}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
