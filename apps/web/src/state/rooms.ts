import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { createRoomEnvironmentAtoms } from "@t3tools/client-runtime/state/rooms";
import type {
  EnvironmentId,
  ProjectAvatar,
  ProjectId,
  RoomId,
  RoomPerson,
  RoomSummary,
  RoomsSnapshot,
  ThreadId,
} from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { environmentProjects } from "./projects";
import { useEnvironmentQuery } from "./query";

export const roomEnvironment = createRoomEnvironmentAtoms(connectionAtomRuntime);

const NO_ROOMS: ReadonlyArray<RoomSummary> = [];
const NO_PEOPLE: ReadonlyArray<RoomPerson> = [];

const roomsAtom = (environmentId: EnvironmentId) =>
  roomEnvironment.rooms({ environmentId, input: {} });

/** The rooms this session sees on one environment, live. */
export function useRooms(environmentId: EnvironmentId | null) {
  const query = useEnvironmentQuery(environmentId === null ? null : roomsAtom(environmentId));
  return {
    rooms: query.data?.rooms ?? NO_ROOMS,
    canCreate: query.data?.canCreate ?? false,
    people: query.data?.people ?? NO_PEOPLE,
    // Assume named until the list says otherwise, so the dialog never flashes the question.
    ownerNamed: query.data?.ownerNamed ?? true,
    loaded: query.data !== null,
  };
}

interface RoomLookup {
  readonly loaded: boolean;
  readonly room: RoomSummary | null;
  readonly canCreate: boolean;
  readonly people: ReadonlyArray<RoomPerson>;
}

const roomLookupAtom = Atom.family((key: string) => {
  const [environmentId, roomId] = JSON.parse(key) as [EnvironmentId, RoomId];
  let previous: RoomLookup | null = null;
  return Atom.make((get): RoomLookup => {
    const snapshot = AsyncResult.getOrElse(get(roomsAtom(environmentId)), () => null);
    const next: RoomLookup = {
      loaded: snapshot !== null,
      room: snapshot?.rooms.find((room) => room.id === roomId) ?? null,
      canCreate: snapshot?.canCreate ?? false,
      people: snapshot?.people ?? NO_PEOPLE,
    };
    // Rooms keep their identity while unchanged, so other rooms' changes stop here.
    if (
      previous !== null &&
      previous.loaded === next.loaded &&
      previous.room === next.room &&
      previous.canCreate === next.canCreate &&
      previous.people === next.people
    ) {
      return previous;
    }
    previous = next;
    return next;
  }).pipe(Atom.withLabel(`room-lookup:${key}`));
});

/** One room from the environment's list, re-rendering only when it (or who may be added) changes. */
export function useRoom(environmentId: EnvironmentId, roomId: RoomId): RoomLookup {
  return useAtomValue(roomLookupAtom(JSON.stringify([environmentId, roomId])));
}

interface RoomBotLook {
  readonly projectId: ProjectId;
  readonly avatar: ProjectAvatar | null;
  /** The viewer's conversation with the bot, when they have one. */
  readonly threadId: ThreadId | null;
}

const roomBotLooksAtom = Atom.family((key: string) => {
  const [environmentId, ...projectIds] = JSON.parse(key) as [EnvironmentId, ...ProjectId[]];
  let previous: ReadonlyArray<RoomBotLook> = [];
  return Atom.make((get) => {
    const next = projectIds.map((projectId): RoomBotLook => {
      const project = get(
        environmentProjects.projectAtom(scopeProjectRef(environmentId, projectId)),
      );
      return {
        projectId,
        avatar: project?.avatar ?? null,
        threadId: project?.mainThreadId ?? null,
      };
    });
    const same =
      previous.length === next.length &&
      next.every(
        (look, index) =>
          look.avatar === previous[index]!.avatar && look.threadId === previous[index]!.threadId,
      );
    if (same) return previous;
    previous = next;
    return next;
  }).pipe(Atom.withLabel(`room-bot-looks:${key}`));
});

/** The look of a room's bots, without following every other project's changes. */
export function useRoomBotLooks(
  environmentId: EnvironmentId,
  projectIds: ReadonlyArray<ProjectId>,
): ReadonlyArray<RoomBotLook> {
  return useAtomValue(roomBotLooksAtom(JSON.stringify([environmentId, ...projectIds])));
}

export interface EnvironmentRooms {
  readonly environmentId: EnvironmentId;
  readonly snapshot: RoomsSnapshot | null;
}

const roomListsAtom = Atom.family((key: string) => {
  const environmentIds = JSON.parse(key) as ReadonlyArray<EnvironmentId>;
  return Atom.make((get): ReadonlyArray<EnvironmentRooms> =>
    environmentIds.map((environmentId) => ({
      environmentId,
      snapshot: AsyncResult.getOrElse(get(roomsAtom(environmentId)), () => null),
    })),
  ).pipe(Atom.withLabel(`room-lists:${key}`));
});

/** Every given environment's rooms, for views that span machines: the sidebar and the palette. */
export function useRoomLists(
  environmentIds: ReadonlyArray<EnvironmentId>,
): ReadonlyArray<EnvironmentRooms> {
  return useAtomValue(roomListsAtom(JSON.stringify(environmentIds)));
}

/** One room's messages and who is working, live; null until the first snapshot. */
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
