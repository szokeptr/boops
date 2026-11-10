import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, RoomId, RoomParticipant } from "@t3tools/contracts";

import { requestConfirmDialog } from "../../confirmDialog";
import { roomEnvironment } from "../../state/rooms";
import { useAtomCommand } from "../../state/use-atom-command";
import { toastManager } from "../ui/toast";
import { discardRoomFiles } from "./roomUploads";

function reportFailure(title: string, result: AtomCommandResult<unknown, unknown>) {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return false;
  const error = squashAtomCommandFailure(result);
  toastManager.add({
    type: "error",
    title,
    description: error instanceof Error ? error.message : "An error occurred.",
  });
  return false;
}

/** Room changes for the room view, sidebar and settings. Every change comes back through `rooms.subscribe`. */
export function useRoomCommands(environmentId: EnvironmentId) {
  const quiet = { reportFailure: false } as const;
  const runRename = useAtomCommand(roomEnvironment.rename, quiet);
  const runAdd = useAtomCommand(roomEnvironment.addParticipant, quiet);
  const runRemove = useAtomCommand(roomEnvironment.removeParticipant, quiet);
  const runLeave = useAtomCommand(roomEnvironment.leave, quiet);
  const runArchive = useAtomCommand(roomEnvironment.setArchived, quiet);
  const runMute = useAtomCommand(roomEnvironment.setMuted, quiet);
  const runDelete = useAtomCommand(roomEnvironment.remove, quiet);
  const ok = (title: string) => (result: AtomCommandResult<unknown, unknown>) =>
    result._tag === "Success" || reportFailure(title, result);
  return {
    rename: (roomId: RoomId, title: string) =>
      runRename({ environmentId, input: { roomId, title } }).then(ok("Could not rename")),
    add: (roomId: RoomId, participant: RoomParticipant) =>
      runAdd({ environmentId, input: { roomId, participant } }).then(ok("Could not add them")),
    remove: async (roomId: RoomId, participant: RoomParticipant, name: string) => {
      const confirmed = await (requestConfirmDialog(
        `Take ${name} out of this group chat? They stop seeing new messages.`,
      ) ?? Promise.resolve(true));
      if (!confirmed) return false;
      return runRemove({ environmentId, input: { roomId, participant } }).then(
        ok("Could not take them out"),
      );
    },
    setArchived: (roomId: RoomId, archived: boolean) =>
      runArchive({ environmentId, input: { roomId, archived } }).then(
        ok(archived ? "Could not archive" : "Could not unarchive"),
      ),
    setMuted: (roomId: RoomId, muted: boolean) =>
      runMute({ environmentId, input: { roomId, muted } }).then(ok("Could not change it")),
    leave: async (roomId: RoomId, title: string) => {
      const confirmed = await (requestConfirmDialog(
        `Leave "${title}"? Someone has to add you back.`,
      ) ?? Promise.resolve(true));
      if (!confirmed) return false;
      const left = await runLeave({ environmentId, input: { roomId } }).then(ok("Could not leave"));
      if (left) discardRoomFiles(environmentId, roomId);
      return left;
    },
    delete: async (roomId: RoomId, title: string) => {
      const confirmed = await (requestConfirmDialog(
        `Delete "${title}" for everyone? Its messages are gone for good.`,
        { variant: "destructive" },
      ) ?? Promise.resolve(true));
      if (!confirmed) return false;
      const deleted = await runDelete({ environmentId, input: { roomId } }).then(
        ok("Could not delete"),
      );
      if (deleted) discardRoomFiles(environmentId, roomId);
      return deleted;
    },
  };
}
