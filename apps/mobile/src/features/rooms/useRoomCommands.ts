import { useAtomValue } from "@effect/atom-react";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  type EnvironmentId,
  type ProjectAvatar,
  type ProjectId,
  ROOM_LISTENS_FOR_MAX_LENGTH,
  type RoomId,
  type RoomParticipant,
  roomParticipantKey,
  type ThreadId,
} from "@t3tools/contracts";

import * as Dialog from "../../components/ui/Dialog";
import { useProjects } from "../../state/entities";
import { memberEnvironment } from "../../state/members";
import { roomEnvironment } from "../../state/rooms";
import { useAtomCommand } from "../../state/use-atom-command";
import { roomViewer } from "./roomPresentation";

function reportFailure(title: string, result: AtomCommandResult<unknown, unknown>): boolean {
  if (result._tag === "Success") return true;
  if (!isAtomCommandInterrupted(result)) {
    const error = squashAtomCommandFailure(result);
    Dialog.alert(
      title,
      error instanceof Error ? error.message : "Something went wrong. Try again.",
    );
  }
  return false;
}

/** Who this session is in an environment's rooms, and the bots it can see. */
export function useRoomViewer(environmentId: EnvironmentId) {
  const sessionMember = useAtomValue(memberEnvironment.sessionMemberAtom(environmentId));
  const projects = useProjects();
  const viewer = roomViewer(sessionMember?.id ?? null);
  const projectOf = (projectId: ProjectId) =>
    projects.find((project) => project.environmentId === environmentId && project.id === projectId);
  const avatarOf = (projectId: ProjectId): ProjectAvatar | null =>
    projectOf(projectId)?.avatar ?? null;
  // A member's session gets each bot's main thread rewritten to her own conversation with it.
  const threadOf = (projectId: ProjectId): ThreadId | null =>
    projectOf(projectId)?.mainThreadId ?? null;
  return { viewer, viewerKey: roomParticipantKey(viewer), avatarOf, threadOf };
}

/** Room changes; every one comes back through `rooms.subscribe`. Confirmations ask first. */
export function useRoomCommands(environmentId: EnvironmentId) {
  const quiet = { reportFailure: false } as const;
  const runRename = useAtomCommand(roomEnvironment.rename, quiet);
  const runAdd = useAtomCommand(roomEnvironment.addParticipant, quiet);
  const runRemove = useAtomCommand(roomEnvironment.removeParticipant, quiet);
  const runLeave = useAtomCommand(roomEnvironment.leave, quiet);
  const runArchive = useAtomCommand(roomEnvironment.setArchived, quiet);
  const runMute = useAtomCommand(roomEnvironment.setMuted, quiet);
  const runListening = useAtomCommand(roomEnvironment.setListening, quiet);
  const runDelete = useAtomCommand(roomEnvironment.remove, quiet);
  const runInterrupt = useAtomCommand(roomEnvironment.interrupt, quiet);
  const ok = (title: string) => (result: AtomCommandResult<unknown, unknown>) =>
    reportFailure(title, result);
  return {
    rename: (roomId: RoomId, current: string) =>
      Dialog.prompt({
        title: "Rename group chat",
        initialValue: current,
        confirmText: "Rename",
        onConfirm: (value) => {
          const title = value.trim();
          if (title === "" || title === current) return;
          void runRename({ environmentId, input: { roomId, title } }).then(ok("Could not rename"));
        },
      }),
    add: (roomId: RoomId, participant: RoomParticipant) =>
      runAdd({ environmentId, input: { roomId, participant } }).then(ok("Could not add them")),
    remove: (roomId: RoomId, participant: RoomParticipant, name: string) =>
      Dialog.confirm({
        title: `Take ${name} out?`,
        message: "They stop seeing this chat. You can add them back later.",
        confirmText: "Take out",
        destructive: true,
        onConfirm: () =>
          void runRemove({ environmentId, input: { roomId, participant } }).then(
            ok("Could not take them out"),
          ),
      }),
    setArchived: (roomId: RoomId, archived: boolean) =>
      runArchive({ environmentId, input: { roomId, archived } }).then(
        ok(archived ? "Could not archive" : "Could not unarchive"),
      ),
    stop: (roomId: RoomId, bot: { readonly projectId: ProjectId; readonly name: string }) =>
      runInterrupt({ environmentId, input: { roomId, projectId: bot.projectId } }).then(
        ok(`Could not stop ${bot.name}`),
      ),
    setMuted: (roomId: RoomId, muted: boolean) =>
      runMute({ environmentId, input: { roomId, muted } }).then(ok("Could not change it")),
    setListening: (
      roomId: RoomId,
      projectId: ProjectId,
      listening: boolean,
      listensFor: string | null,
    ) =>
      runListening({ environmentId, input: { roomId, projectId, listening, listensFor } }).then(
        ok("Could not change it"),
      ),
    /** Asks what a listening bot is here for; empty clears it. */
    editListensFor: (
      roomId: RoomId,
      bot: { readonly projectId: ProjectId; readonly name: string },
      current: string | null,
    ) =>
      Dialog.prompt({
        title: `What is ${bot.name} here for?`,
        message:
          "It chimes in when the chat is about this. Leave empty for anything it can help with.",
        initialValue: current ?? "",
        confirmText: "Save",
        onConfirm: (value) => {
          const listensFor = value.trim().slice(0, ROOM_LISTENS_FOR_MAX_LENGTH);
          void runListening({
            environmentId,
            input: {
              roomId,
              projectId: bot.projectId,
              listening: true,
              listensFor: listensFor === "" ? null : listensFor,
            },
          }).then(ok("Could not change it"));
        },
      }),
    leave: (roomId: RoomId, title: string, onDone: () => void) =>
      Dialog.confirm({
        title: `Leave "${title}"?`,
        message: "Someone has to add you back.",
        confirmText: "Leave",
        destructive: true,
        onConfirm: () =>
          void runLeave({ environmentId, input: { roomId } }).then((result) => {
            if (ok("Could not leave")(result)) onDone();
          }),
      }),
    delete: (roomId: RoomId, title: string, onDone: () => void) =>
      Dialog.confirm({
        title: `Delete "${title}"?`,
        message: "It's deleted for everyone. Its messages are gone for good.",
        confirmText: "Delete",
        destructive: true,
        onConfirm: () =>
          void runDelete({ environmentId, input: { roomId } }).then((result) => {
            if (ok("Could not delete")(result)) onDone();
          }),
      }),
  };
}
