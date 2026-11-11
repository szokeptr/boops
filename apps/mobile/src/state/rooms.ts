import { useAtomValue } from "@effect/atom-react";
import { createRoomEnvironmentAtoms } from "@t3tools/client-runtime/state/rooms";
import type { EnvironmentId, RoomId, RoomPerson, RoomSummary } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { useEnvironmentQuery } from "./query";

export const roomEnvironment = createRoomEnvironmentAtoms(connectionAtomRuntime);

const NO_ROOMS: ReadonlyArray<RoomSummary> = [];
const NO_PEOPLE: ReadonlyArray<RoomPerson> = [];

/** The rooms this session sees on one environment, live. */
export function useRooms(environmentId: EnvironmentId | null) {
  const query = useEnvironmentQuery(
    environmentId === null ? null : roomEnvironment.rooms({ environmentId, input: {} }),
  );
  return {
    rooms: query.data?.rooms ?? NO_ROOMS,
    canCreate: query.data?.canCreate ?? false,
    people: query.data?.people ?? NO_PEOPLE,
    /** Bots can chime in without an @mention: the owner set an OpenAI API key. */
    canListen: query.data?.canListen ?? false,
    // Assume named until the list says otherwise, so the sheet never flashes the question.
    ownerNamed: query.data?.ownerNamed ?? true,
    loaded: query.data !== null,
  };
}

/** One room's messages, who is working and what they wait on, live; null until the first snapshot. */
export function useRoomFeed(environmentId: EnvironmentId, roomId: RoomId) {
  return useEnvironmentQuery(roomEnvironment.feed({ environmentId, input: { roomId } }));
}

export interface SidebarRoom {
  readonly environmentId: EnvironmentId;
  readonly room: RoomSummary;
}

const openRoomsAtom = Atom.family((environmentIds: string) =>
  Atom.make((get): ReadonlyArray<SidebarRoom> =>
    environmentIds
      .split("\n")
      .filter((id) => id.length > 0)
      .flatMap((id) => {
        const environmentId = id as EnvironmentId;
        const snapshot = AsyncResult.getOrElse(
          get(roomEnvironment.rooms({ environmentId, input: {} })),
          () => null,
        );
        return (snapshot?.rooms ?? [])
          .filter((room) => room.joined && room.archivedAt === null)
          .map((room) => ({ environmentId, room }));
      }),
  ),
);

/** Open rooms this session is in, across the given environments, for sidebar sections. */
export function useOpenRooms(environmentIds: ReadonlyArray<EnvironmentId>) {
  return useAtomValue(openRoomsAtom(environmentIds.join("\n")));
}
