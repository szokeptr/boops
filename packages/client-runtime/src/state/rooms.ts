import {
  type ProjectId,
  type RoomFeedItem,
  type RoomMessage,
  type RoomPendingRequest,
  type RoomsSnapshot,
  WS_METHODS,
} from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";
import * as Stream from "effect/Stream";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { reuseUnchanged } from "./serverConfigProjection.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

/** A room's live view: the newest page and everything since, and the bots taking a turn. */
export interface RoomFeedState {
  readonly messages: ReadonlyArray<RoomMessage>;
  readonly hasOlder: boolean;
  readonly working: ReadonlyArray<ProjectId>;
  /** Bots waiting on someone here: approvals and questions. */
  readonly requests: ReadonlyArray<RoomPendingRequest>;
}

const EMPTY_FEED: RoomFeedState = { messages: [], hasOlder: false, working: [], requests: [] };

/**
 * A snapshot after a reconnect keeps what was already shown when it joins up with it, so pages
 * loaded earlier still meet the feed; one that leaves a gap starts the view over.
 */
function applySnapshot(
  state: RoomFeedState,
  history: { readonly messages: ReadonlyArray<RoomMessage>; readonly hasOlder: boolean },
): RoomFeedState {
  const first = history.messages[0];
  const last = state.messages.at(-1);
  if (first === undefined || last === undefined || first.seq > last.seq + 1) {
    return { ...state, messages: history.messages, hasOlder: history.hasOlder };
  }
  const ids = new Set(history.messages.map((message) => message.id));
  const kept = state.messages.filter((message) => message.seq < first.seq && !ids.has(message.id));
  return {
    ...state,
    messages: kept.length === 0 ? history.messages : [...kept, ...history.messages],
    hasOlder: kept.length === 0 ? history.hasOlder : state.hasOlder,
  };
}

/** Folds one feed item into the view. A message already shown (a reconnect's snapshot) is kept once. */
export function applyRoomFeedItem(state: RoomFeedState, item: RoomFeedItem): RoomFeedState {
  switch (item.kind) {
    case "snapshot":
      return applySnapshot(state, item.history);
    case "message":
      return state.messages.some((message) => message.id === item.message.id)
        ? state
        : { ...state, messages: [...state.messages, item.message] };
    case "working":
      return { ...state, working: item.working };
    case "requests":
      return { ...state, requests: item.requests };
  }
}

/** Keeps unchanged rooms the same objects, so a view of one room skips others' changes. */
function reuseUnchangedRooms(previous: RoomsSnapshot | null, next: RoomsSnapshot): RoomsSnapshot {
  if (previous === null) return next;
  const before = new Map(previous.rooms.map((room) => [room.id, room]));
  const rooms = next.rooms.map((room) => reuseUnchanged(before.get(room.id), room));
  return reuseUnchanged(previous, { ...next, rooms });
}

/**
 * Pages loaded with `history` in front of the live feed. Pages that no longer reach the feed (a
 * reconnect started it over past them) are left out, so no hole shows; load earlier refills.
 */
export function joinRoomMessages(
  older: {
    readonly messages: ReadonlyArray<RoomMessage>;
    readonly hasOlder: boolean;
  } | null,
  feed: { readonly messages: ReadonlyArray<RoomMessage>; readonly hasOlder: boolean },
): {
  readonly messages: ReadonlyArray<RoomMessage>;
  readonly hasOlder: boolean;
  readonly olderUsed: boolean;
} {
  const first = feed.messages[0];
  const olderLast = older?.messages.at(-1);
  if (
    older === null ||
    olderLast === undefined ||
    (first !== undefined && olderLast.seq + 1 < first.seq)
  ) {
    return { messages: feed.messages, hasOlder: feed.hasOlder, olderUsed: false };
  }
  const ids = new Set(feed.messages.map((message) => message.id));
  return {
    messages: [...older.messages.filter((message) => !ids.has(message.id)), ...feed.messages],
    hasOlder: older.hasOlder,
    olderUsed: true,
  };
}

/**
 * Group chats on an environment, for the owner and members alike; the server decides which rooms
 * each session sees and what it may change.
 */
export function createRoomEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    rooms: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:rooms",
      tag: WS_METHODS.roomsSubscribe,
      transform: (stream) =>
        stream.pipe(
          Stream.mapAccum(
            () => null as RoomsSnapshot | null,
            (previous, snapshot) => {
              const next = reuseUnchangedRooms(previous, snapshot);
              return [next, [next]] as const;
            },
          ),
        ),
    }),
    feed: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:rooms:feed",
      tag: WS_METHODS.roomsSubscribeFeed,
      // The empty start is not a view: the server's snapshot is always first.
      transform: (stream) =>
        stream.pipe(
          Stream.scan(() => EMPTY_FEED, applyRoomFeedItem),
          Stream.drop(1),
        ),
    }),
    create: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:rooms:create",
      tag: WS_METHODS.roomsCreate,
    }),
    rename: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:rooms:rename",
      tag: WS_METHODS.roomsRename,
    }),
    addParticipant: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:rooms:add-participant",
      tag: WS_METHODS.roomsAddParticipant,
    }),
    removeParticipant: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:rooms:remove-participant",
      tag: WS_METHODS.roomsRemoveParticipant,
    }),
    leave: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:rooms:leave",
      tag: WS_METHODS.roomsLeave,
    }),
    setArchived: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:rooms:set-archived",
      tag: WS_METHODS.roomsSetArchived,
    }),
    setMuted: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:rooms:set-muted",
      tag: WS_METHODS.roomsSetMuted,
    }),
    remove: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:rooms:delete",
      tag: WS_METHODS.roomsDelete,
    }),
    post: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:rooms:post",
      tag: WS_METHODS.roomsPost,
    }),
    markRead: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:rooms:mark-read",
      tag: WS_METHODS.roomsMarkRead,
    }),
    respond: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:rooms:respond",
      tag: WS_METHODS.roomsRespond,
    }),
    interrupt: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:rooms:interrupt",
      tag: WS_METHODS.roomsInterrupt,
    }),
    history: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:rooms:history",
      tag: WS_METHODS.roomsHistory,
    }),
  };
}
