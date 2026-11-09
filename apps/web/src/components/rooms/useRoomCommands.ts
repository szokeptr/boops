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
    remove: (roomId: RoomId, participant: RoomParticipant) =>
      runRemove({ environmentId, input: { roomId, participant } }).then(
        ok("Could not take them out"),
      ),
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
      return runLeave({ environmentId, input: { roomId } }).then(ok("Could not leave"));
    },
    delete: async (roomId: RoomId, title: string) => {
      const confirmed = await (requestConfirmDialog(
        `Delete "${title}" for everyone? Its messages are gone for good.`,
        { variant: "destructive" },
      ) ?? Promise.resolve(true));
      if (!confirmed) return false;
      return runDelete({ environmentId, input: { roomId } }).then(ok("Could not delete"));
    },
  };
}
