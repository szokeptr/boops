import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  defaultRoomTitle,
  type EnvironmentId,
  type ProjectAvatar,
  roomParticipantKey,
  type RoomParticipant,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { CheckIcon } from "lucide-react";
import { useId, useState } from "react";
import { create } from "zustand";

import { useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { useProjects } from "../../state/entities";
import { memberEnvironment } from "../../state/members";
import { roomEnvironment, useRooms } from "../../state/rooms";
import { useAtomCommand } from "../../state/use-atom-command";
import { BotAvatar } from "../bots/BotAvatar";
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
import { PersonFace } from "./RoomAvatar";

const useDialog = create<{ environmentId: EnvironmentId | null; session: number }>(() => ({
  environmentId: null,
  session: 0,
}));

/** Opens New group chat for a machine. The sidebar and the command palette call this. */
export function openCreateRoomDialog(environmentId: EnvironmentId) {
  useDialog.setState((state) => ({ environmentId, session: state.session + 1 }));
}

function close() {
  useDialog.setState({ environmentId: null });
}

export function CreateRoomDialogHost() {
  const environmentId = useDialog((state) => state.environmentId);
  const session = useDialog((state) => state.session);
  return environmentId === null ? null : (
    <CreateRoomDialog key={session} environmentId={environmentId} />
  );
}

interface Candidate {
  readonly participant: RoomParticipant;
  readonly name: string;
  readonly avatar?: ProjectAvatar | null;
}

function CreateRoomDialog({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const id = useId();
  const navigate = useNavigate();
  const createRoom = useAtomCommand(roomEnvironment.create, { reportFailure: false });
  // A member's session sees only the bots shared with them, which are the ones they may bring.
  const bots: ReadonlyArray<Candidate> = useProjects()
    .filter((project) => project.environmentId === environmentId && !project.isScratch)
    .map((project) => ({
      participant: { kind: "bot", projectId: project.id },
      name: project.title,
      avatar: project.avatar ?? null,
    }));
  const { people, ownerNamed } = useRooms(environmentId);
  const isOwner = useAtomValue(memberEnvironment.sessionMemberAtom(environmentId)) === null;
  const candidates: ReadonlyArray<Candidate> = [
    ...bots,
    ...people.map((entry): Candidate => ({ participant: entry.person, name: entry.name })),
  ];
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [title, setTitle] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const askName = isOwner && !ownerNamed;
  const chosen = candidates.filter((entry) => picked.has(roomParticipantKey(entry.participant)));
  const placeholder = defaultRoomTitle(chosen.map((entry) => entry.name));

  const toggle = (entry: Candidate) => {
    const key = roomParticipantKey(entry.participant);
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const submit = async (saveName: ((name: string) => void) | null) => {
    if (submitting || chosen.length === 0) return;
    if (saveName !== null) {
      if (ownerName.trim() === "") {
        setError("Tell the others what to call you.");
        return;
      }
      saveName(ownerName.trim());
    }
    setSubmitting(true);
    setError(null);
    const result = await createRoom({
      environmentId,
      input: {
        title: title.trim() || placeholder,
        botProjectIds: chosen.flatMap((entry) =>
          entry.participant.kind === "bot" ? [entry.participant.projectId] : [],
        ),
        memberIds: chosen.flatMap((entry) =>
          entry.participant.kind === "member" ? [entry.participant.memberId] : [],
        ),
        ...(isOwner ? {} : { includeOwner: picked.has("owner") }),
      },
    });
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const cause = squashAtomCommandFailure(result);
        setError(cause instanceof Error ? cause.message : "Could not start the group chat.");
      }
      setSubmitting(false);
      return;
    }
    close();
    await navigate({
      to: "/rooms/$environmentId/$roomId",
      params: { environmentId, roomId: result.value.id },
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogPopup className="sm:max-w-md">
        {askName ? (
          <OwnerNameSaver environmentId={environmentId}>
            {(saveName) => (
              <Form
                id={id}
                submitting={submitting}
                canSubmit={chosen.length > 0}
                onSubmit={() => void submit(saveName)}
                nameField={
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`${id}-owner`}>Your name</Label>
                    <Input
                      id={`${id}-owner`}
                      value={ownerName}
                      onChange={(event) => setOwnerName(event.target.value)}
                      maxLength={60}
                      autoComplete="given-name"
                      placeholder="What should everyone call you?"
                    />
                  </div>
                }
                {...{ title, setTitle, placeholder, candidates, picked, toggle, error }}
              />
            )}
          </OwnerNameSaver>
        ) : (
          <Form
            id={id}
            submitting={submitting}
            canSubmit={chosen.length > 0}
            onSubmit={() => void submit(null)}
            nameField={null}
            {...{ title, setTitle, placeholder, candidates, picked, toggle, error }}
          />
        )}
      </DialogPopup>
    </Dialog>
  );
}

/** Saving the owner's name needs settings access, which only the owner's session has. */
function OwnerNameSaver(props: {
  readonly environmentId: EnvironmentId;
  readonly children: (saveName: (name: string) => void) => React.ReactNode;
}) {
  const updateSettings = useUpdateEnvironmentSettings(props.environmentId);
  return props.children((ownerName) => updateSettings({ ownerName }));
}

function Form(props: {
  readonly id: string;
  readonly submitting: boolean;
  readonly canSubmit: boolean;
  readonly onSubmit: () => void;
  readonly nameField: React.ReactNode;
  readonly title: string;
  readonly setTitle: (title: string) => void;
  readonly placeholder: string;
  readonly candidates: ReadonlyArray<Candidate>;
  readonly picked: ReadonlySet<string>;
  readonly toggle: (entry: Candidate) => void;
  readonly error: string | null;
}) {
  const { id } = props;
  return (
    <form
      className="flex min-h-0 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit();
      }}
    >
      <DialogHeader>
        <DialogTitle>New group chat</DialogTitle>
        <DialogDescription>
          Pick who's in it. Bots answer when someone @mentions them, and catch up on what they
          missed.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        {props.nameField}
        {props.candidates.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Add a bot or invite someone first, then start a group chat with them.
          </p>
        ) : (
          <ul aria-label="Who's in it" className="grid grid-cols-4 gap-1 sm:grid-cols-5">
            {props.candidates.map((entry) => {
              const key = roomParticipantKey(entry.participant);
              const selected = props.picked.has(key);
              return (
                <li key={key}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => props.toggle(entry)}
                    className="group flex w-full cursor-pointer flex-col items-center gap-1.5 rounded-xl px-1 pt-2 pb-1.5 outline-hidden hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <span className="relative">
                      <span
                        className={cn(
                          "block rounded-full transition-[box-shadow,opacity] duration-150",
                          selected
                            ? "ring-2 ring-primary ring-offset-2 ring-offset-popover"
                            : "opacity-80 group-hover:opacity-100",
                        )}
                      >
                        {entry.participant.kind === "bot" ? (
                          <BotAvatar
                            avatar={entry.avatar ?? null}
                            name={entry.name}
                            status="idle"
                            size={44}
                          />
                        ) : (
                          <PersonFace size={44} />
                        )}
                      </span>
                      {selected ? (
                        <span className="absolute -right-0.5 -bottom-0.5 flex size-4.5 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-popover">
                          <CheckIcon className="size-3" strokeWidth={3} />
                        </span>
                      ) : null}
                    </span>
                    <span className="w-full truncate text-center text-xs">{entry.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-title`}>Name</Label>
          <Input
            id={`${id}-title`}
            value={props.title}
            onChange={(event) => props.setTitle(event.target.value)}
            maxLength={80}
            autoComplete="off"
            placeholder={props.placeholder}
          />
        </div>
        {props.error === null ? null : (
          <p role="alert" className="text-destructive-foreground text-sm">
            {props.error}
          </p>
        )}
      </DialogPanel>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={close}>
          Cancel
        </Button>
        <Button type="submit" disabled={props.submitting || !props.canSubmit}>
          Start chat
        </Button>
      </DialogFooter>
    </form>
  );
}
