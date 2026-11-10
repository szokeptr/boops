import type { RoomSummary } from "@t3tools/contracts";

/** When a room last saw anything: its newest message, or its creation while it is quiet. */
export const roomLastActivity = (room: RoomSummary): string =>
  room.lastMessage?.createdAt ?? room.createdAt;

/** Newest conversation first, as a messages app sorts. */
export function sortRoomsByActivity(rooms: ReadonlyArray<RoomSummary>): ReadonlyArray<RoomSummary> {
  return [...rooms].sort((a, b) => roomLastActivity(b).localeCompare(roomLastActivity(a)));
}
