import {
  type ProjectId,
  type RoomFeedItem,
  type RoomMessage,
  type RoomPendingRequest,
  WS_METHODS,
} from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";
import * as Stream from "effect/Stream";

import type { EnvironmentRegistry } from "../connection/registry.ts";
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

/** Folds one feed item into the view. A message already shown (a reconnect's snapshot) is kept once. */
function applyRoomFeedItem(state: RoomFeedState, item: RoomFeedItem): RoomFeedState {
  switch (item.kind) {
    case "snapshot":
      return { ...state, messages: item.history.messages, hasOlder: item.history.hasOlder };
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
    history: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:rooms:history",
      tag: WS_METHODS.roomsHistory,
    }),
  };
}
