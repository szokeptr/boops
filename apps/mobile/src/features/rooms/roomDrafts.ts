import { type EnvironmentId, type RoomId, ThreadId } from "@t3tools/contracts";

import { scopedThreadKey } from "../../lib/scopedEntities";

/** A room's composer draft is kept like a thread's, under the room's own key. */
export function roomDraftKey(environmentId: EnvironmentId, roomId: RoomId): string {
  return scopedThreadKey(environmentId, ThreadId.make(`room-${roomId}`));
}

/** Drafts on one machine for rooms the viewer is no longer in: left, removed from, or deleted. */
export function staleRoomDraftKeys(
  draftKeys: Iterable<string>,
  environmentId: EnvironmentId,
  joinedRoomIds: ReadonlyArray<RoomId>,
): ReadonlyArray<string> {
  const prefix = scopedThreadKey(environmentId, ThreadId.make("room-"));
  const kept = new Set(joinedRoomIds.map((roomId) => roomDraftKey(environmentId, roomId)));
  return [...draftKeys].filter((key) => key.startsWith(prefix) && !kept.has(key));
}
