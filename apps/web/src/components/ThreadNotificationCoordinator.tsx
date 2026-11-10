import {
  type EnvironmentThreadShell,
  type PendingSubagentRequest,
  presentThreadShell,
} from "@t3tools/client-runtime/state/models";
import { isShownUnderParent } from "@t3tools/client-runtime/state/threads";
import { botMessagePreview, isBotConversationThread } from "@t3tools/client-runtime/state/bot-list";
import type { AnyRouter } from "@tanstack/react-router";
import { threadKey } from "@t3tools/client-runtime/state/entities";
import type {
  EnvironmentId,
  OrchestrationProjectShell,
  OrchestrationV2ThreadShell,
  ProjectId,
  RoomId,
  RoomSummary,
  ThreadId,
} from "@t3tools/contracts";
import type { ClientSettings } from "@t3tools/contracts/settings";
import * as Option from "effect/Option";
import { AsyncResult, type AtomRegistry } from "effect/reactivity";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  MessageCircleQuestionIcon,
  ShieldQuestionIcon,
  UsersIcon,
} from "lucide-react";

import { getClientSettings, subscribeClientSettings } from "../hooks/useSettings";
import { isWindowsPlatform } from "../lib/utils";
import { environmentSummaries } from "../state/presentation";
import { roomEnvironment } from "../state/rooms";
import { environmentShell } from "../state/shell";
import { environmentThreadShells } from "../state/threads";
import {
  hasDesktopNotifications,
  hasNotificationSound,
  playNotificationSound,
  roomNotificationTag,
  setNotificationBadge,
  threadNotificationTag,
  unlockNotificationAudio,
} from "../threadNotifications";
import {
  resolveThreadStatus,
  type ThreadStatus,
} from "@t3tools/client-runtime/state/thread-status";
import {
  createThreadNotificationGate,
  observeRoomNotification,
  type RoomNotificationObservation,
  type ThreadNotificationKind,
  type ThreadNotificationObservation,
} from "./ThreadNotificationCoordinator.logic";
import { roomMessagePreview } from "./rooms/roomPreview";
import { toastManager } from "./ui/toast";

interface NotificationState extends ThreadNotificationObservation {
  readonly raw: OrchestrationV2ThreadShell;
  readonly botName: string;
  readonly subagentRequest: PendingSubagentRequest | null;
  readonly thread: EnvironmentThreadShell;
  readonly status: ThreadStatus;
}

type ToastId = ReturnType<typeof toastManager.add>;

interface WatchedEnvironment {
  unsubscribe: () => void;
  previous: Map<ThreadId, NotificationState>;
  rooms: Map<RoomId, RoomNotificationObservation>;
  reconnecting: boolean;
  readonly gate: ReturnType<typeof createThreadNotificationGate<ThreadId>>;
}

/**
 * Turns thread status transitions in every connected environment into sounds, in-app toasts,
 * and desktop notifications, and keeps the dock badge in step with the unread ones.
 */
export function startThreadNotifications(
  registry: AtomRegistry.AtomRegistry,
  router: AnyRouter,
): () => void {
  // Desktop notifications on screen by tag; `threadKey` is null for a group chat's.
  const pending = new Map<
    string,
    { environmentId: EnvironmentId; threadKey: string | null; notification: Notification }
  >();
  const watched = new Map<EnvironmentId, WatchedEnvironment>();

  const trackNotification = (
    environmentId: EnvironmentId,
    threadKeyOfNotification: string | null,
    notification: Notification,
  ) => {
    pending.get(notification.tag)?.notification.close();
    pending.set(notification.tag, {
      environmentId,
      threadKey: threadKeyOfNotification,
      notification,
    });
    setNotificationBadge(pending.size);
  };
  // Toast ids by thread key, so hiding a thread can close its open toasts.
  const openToasts = new Map<string, Array<ToastId>>();
  const forgetToast = (key: string, toastId: ToastId) => {
    const remaining = (openToasts.get(key) ?? []).filter((id) => id !== toastId);
    if (remaining.length === 0) openToasts.delete(key);
    else openToasts.set(key, remaining);
  };
  // A notification shown before the tag filter turned on must not stay on screen. While hiding,
  // one whose thread left the live list (archived) cannot be judged, so it closes too.
  const closeHiddenPending = () => {
    const hidden = registry.get(environmentThreadShells.hiddenThreadKeysAtom);
    const live = registry.get(environmentThreadShells.anyEnvironmentHidingAtom)
      ? new Set(registry.get(environmentThreadShells.threadRefsAtom).map(threadKey))
      : null;
    const shouldClose = (key: string) => hidden.has(key) || (live !== null && !live.has(key));
    for (const [key, toastIds] of openToasts) {
      if (!shouldClose(key)) continue;
      for (const toastId of toastIds) toastManager.close(toastId);
      openToasts.delete(key);
    }
    const count = pending.size;
    for (const [tag, entry] of pending) {
      if (entry.threadKey === null || !shouldClose(entry.threadKey)) continue;
      entry.notification.close();
      pending.delete(tag);
    }
    if (count !== pending.size) setNotificationBadge(pending.size);
  };
  const clearPending = () => {
    for (const { notification } of pending.values()) notification.close();
    pending.clear();
    setNotificationBadge(0);
  };

  const present = (
    environmentId: EnvironmentId,
    state: NotificationState,
    kind: ThreadNotificationKind,
  ) => {
    const { thread, status } = state;
    if (
      registry
        .get(environmentThreadShells.hiddenThreadKeysAtom)
        .has(threadKey({ environmentId, threadId: thread.id }))
    )
      return;
    const { notificationMode: mode, inAppNotificationsEnabled } = getClientSettings();
    const active = (router.state.matches.at(-1)?.params ?? {}) as {
      environmentId?: string;
      threadId?: string;
    };
    const reply = state.raw.latestVisibleMessage;
    const title =
      kind === "completion"
        ? state.botName
        : status === "approval"
          ? "Approval needed"
          : status === "limited"
            ? "Usage limit reached"
            : status === "failed"
              ? "Thread failed"
              : status === "request"
                ? "Guest request"
                : "Input needed";
    // A reply reads like a message from the bot; anything else names the bot it concerns.
    const body =
      kind === "completion" && reply !== null
        ? (botMessagePreview(reply.text) ?? state.botName)
        : state.botName;
    if (hasNotificationSound(mode)) {
      void playNotificationSound(kind, () =>
        hasNotificationSound(getClientSettings().notificationMode),
      );
    }
    if (
      inAppNotificationsEnabled &&
      document.visibilityState === "visible" &&
      document.hasFocus() &&
      (active.environmentId !== environmentId || active.threadId !== thread.id)
    ) {
      const toastKey = threadKey({ environmentId, threadId: thread.id });
      const toastId: ToastId = toastManager.add({
        onRemove: (): void => forgetToast(toastKey, toastId),
        type: kind === "completion" ? "success" : status === "failed" ? "error" : "warning",
        title,
        description: body,
        data: {
          hideCopyButton: true,
          leadingIcon:
            kind === "completion" ? (
              <CircleCheckIcon aria-hidden className="size-4 text-success-foreground" />
            ) : status === "approval" ? (
              <ShieldQuestionIcon aria-hidden className="size-4 text-warning-foreground" />
            ) : status === "limited" ? (
              <CircleAlertIcon aria-hidden className="size-4 text-warning-foreground" />
            ) : status === "failed" ? (
              <CircleAlertIcon aria-hidden className="size-4 text-destructive-foreground" />
            ) : (
              <MessageCircleQuestionIcon aria-hidden className="size-4 text-info-foreground" />
            ),
        },
        actionProps: {
          children: "Open thread",
          onClick: () => {
            toastManager.close(toastId);
            void router.navigate({
              to: "/$environmentId/$threadId",
              params: { environmentId, threadId: thread.id },
            });
          },
        },
      });
      openToasts.set(toastKey, [...(openToasts.get(toastKey) ?? []), toastId]);
      return;
    }
    if (
      !hasDesktopNotifications(mode) ||
      (document.visibilityState === "visible" && document.hasFocus()) ||
      typeof Notification === "undefined" ||
      Notification.permission !== "granted"
    )
      return;
    try {
      const notification = new Notification(title, {
        body,
        tag: threadNotificationTag(environmentId, thread.id),
        silent: true,
        // Windows drops clicks after a toast moves into Notification Center.
        requireInteraction: kind === "completion" && isWindowsPlatform(navigator.platform),
      });
      trackNotification(
        environmentId,
        threadKey({ environmentId, threadId: thread.id }),
        notification,
      );
      notification.addEventListener("click", () => {
        notification.close();
        window.focus();
        void window.desktopBridge?.revealWindow().catch(() => undefined);
        void router.navigate({
          to: "/$environmentId/$threadId",
          params: { environmentId, threadId: thread.id },
        });
      });
    } catch {
      // Some browsers expose Notification but reject desktop presentation.
    }
  };

  const presentRoom = (
    environmentId: EnvironmentId,
    room: RoomSummary,
    kind: ThreadNotificationKind,
  ) => {
    const { notificationMode: mode, inAppNotificationsEnabled } = getClientSettings();
    const active = (router.state.matches.at(-1)?.params ?? {}) as {
      environmentId?: string;
      roomId?: string;
    };
    const inFront = document.visibilityState === "visible" && document.hasFocus();
    if (inFront && active.environmentId === environmentId && active.roomId === room.id) return;
    const last = room.lastMessage;
    const title = kind === "input" ? "Needs you" : room.title;
    const body =
      kind === "input" ? room.title : last === null ? room.title : roomMessagePreview(last, null);
    const open = () =>
      void router.navigate({
        to: "/rooms/$environmentId/$roomId",
        params: { environmentId, roomId: room.id },
      });
    if (hasNotificationSound(mode)) {
      void playNotificationSound(kind, () =>
        hasNotificationSound(getClientSettings().notificationMode),
      );
    }
    if (inAppNotificationsEnabled && inFront) {
      const toastId: ToastId = toastManager.add({
        type: kind === "input" ? "warning" : "info",
        title,
        description: body,
        data: {
          hideCopyButton: true,
          leadingIcon:
            kind === "input" ? (
              <MessageCircleQuestionIcon aria-hidden className="size-4 text-info-foreground" />
            ) : (
              <UsersIcon aria-hidden className="size-4 text-muted-foreground" />
            ),
        },
        actionProps: {
          children: "Open chat",
          onClick: () => {
            toastManager.close(toastId);
            open();
          },
        },
      });
      return;
    }
    if (
      !hasDesktopNotifications(mode) ||
      inFront ||
      typeof Notification === "undefined" ||
      Notification.permission !== "granted"
    )
      return;
    try {
      const notification = new Notification(title, {
        body,
        tag: roomNotificationTag(environmentId, room.id),
        silent: true,
      });
      trackNotification(environmentId, null, notification);
      notification.addEventListener("click", () => {
        notification.close();
        window.focus();
        void window.desktopBridge?.revealWindow().catch(() => undefined);
        open();
      });
    } catch {
      // Some browsers expose Notification but reject desktop presentation.
    }
  };

  const observeRooms = (
    environmentId: EnvironmentId,
    entry: WatchedEnvironment,
    rooms: ReadonlyArray<RoomSummary>,
  ) => {
    const next = new Map<RoomId, RoomNotificationObservation>();
    const changed: Array<[RoomSummary, ThreadNotificationKind]> = [];
    for (const room of rooms) {
      const last = room.lastMessage;
      const { observation, kind } = observeRoomNotification(entry.rooms.get(room.id), {
        lastMessageId: last?.id ?? null,
        lastAuthor:
          last === null
            ? null
            : last.author.kind === "bot" || last.author.kind === "system"
              ? last.author.kind
              : "person",
        lastMentionsBots: (last?.mentions.length ?? 0) > 0,
        working: room.working.length > 0,
        unread: room.unread,
        needsYou: room.needsYou,
        muted: room.muted,
        listed: room.joined && room.archivedAt === null,
      });
      next.set(room.id, observation);
      if (kind !== null) changed.push([room, kind]);
    }
    entry.rooms = next;
    for (const [room, kind] of changed) presentRoom(environmentId, room, kind);
  };

  const observeThreads = (
    environmentId: EnvironmentId,
    entry: WatchedEnvironment,
    threads: ReadonlyArray<OrchestrationV2ThreadShell>,
    projects: ReadonlyMap<ProjectId, OrchestrationProjectShell>,
  ) => {
    const previous = entry.previous;
    const next = new Map<ThreadId, NotificationState>();
    // A parent here also hears of what its tasks on linked environments ask.
    const subagentRequests = registry.get(
      environmentThreadShells.pendingSubagentRequestsAtom(environmentId),
    );
    const delegatedUnderParent = registry.get(environmentThreadShells.delegatedUnderParentAtom);
    const changed: Array<[NotificationState | undefined, NotificationState]> = [];
    for (const rawThread of threads) {
      if (
        isShownUnderParent(
          { environmentId, threadId: rawThread.id },
          rawThread.lineage,
          delegatedUnderParent,
        )
      ) {
        continue;
      }
      // Only a bot's conversations notify; routines, Heartbeat and plain projects are background work.
      const project = projects.get(rawThread.projectId);
      if (
        project?.mainThreadId == null ||
        !isBotConversationThread(rawThread, project.mainThreadId)
      ) {
        continue;
      }
      const prior = previous.get(rawThread.id);
      const subagentRequest = subagentRequests.get(rawThread.id) ?? null;
      if (
        !entry.reconnecting &&
        prior?.raw === rawThread &&
        prior.botName === project.title &&
        prior.subagentRequest === subagentRequest
      ) {
        next.set(rawThread.id, prior);
        continue;
      }
      const thread = presentThreadShell(environmentId, rawThread, subagentRequest);
      let status = resolveThreadStatus(thread);
      if (status === "ready" && thread.latestRun?.status === "failed") status = "failed";
      const attention =
        status === "input" ||
        status === "request" ||
        status === "approval" ||
        status === "failed" ||
        status === "limited"
          ? `${thread.latestRun?.runId ?? ""}:${status}`
          : null;
      const completedAt = Date.parse(thread.latestRun?.completedAt ?? "");
      // A turn that ends without the bot saying anything is not a message.
      const settled =
        status === "ready" &&
        thread.latestRun?.status === "completed" &&
        rawThread.latestVisibleMessage?.role === "assistant";
      const state = {
        raw: rawThread,
        botName: project.title,
        subagentRequest,
        thread,
        status,
        attention,
        settled,
        completedAt: settled && Number.isFinite(completedAt) ? completedAt : null,
      };
      next.set(thread.id, state);
      changed.push([prior, state]);
    }
    entry.reconnecting = false;
    entry.previous = next;
    entry.gate.retain(new Set(next.keys()));
    for (const [prior, state] of changed) {
      entry.gate.observe(state.thread.id, prior, state, {
        archived: state.thread.archivedAt !== null,
        quiet: state.raw.latestRunStopRequested === true,
      });
    }
  };

  const watchEnvironment = (environmentId: EnvironmentId): WatchedEnvironment => {
    const entry: WatchedEnvironment = {
      previous: new Map(),
      rooms: new Map(),
      reconnecting: false,
      unsubscribe: () => {},
      gate: createThreadNotificationGate<ThreadId>((threadId, kind) => {
        const state = entry.previous.get(threadId);
        if (state) present(environmentId, state, kind);
      }),
    };
    let live: Parameters<typeof observeThreads> | null = null;
    const unsubscribeShell = registry.subscribe(
      environmentShell.stateValueAtom(environmentId),
      (shell) => {
        live =
          shell.status === "live" && Option.isSome(shell.snapshot)
            ? [
                environmentId,
                entry,
                shell.snapshot.value.threads,
                new Map(shell.snapshot.value.projects.map((project) => [project.id, project])),
              ]
            : null;
        if (live !== null) {
          observeThreads(...live);
          return;
        }
        entry.reconnecting = true;
      },
      { immediate: true },
    );
    const reobserve = () => {
      if (live !== null) observeThreads(...live);
    };
    const unsubscribeRequests = registry.subscribe(
      environmentThreadShells.pendingSubagentRequestsAtom(environmentId),
      reobserve,
    );
    const unsubscribeDelegated = registry.subscribe(
      environmentThreadShells.delegatedUnderParentAtom,
      reobserve,
    );
    // Only a room list that changed is compared; failures and reconnects keep the last one.
    const unsubscribeRooms = registry.subscribe(
      roomEnvironment.rooms({ environmentId, input: {} }),
      (result) => {
        const snapshot = AsyncResult.getOrElse(result, () => null);
        if (snapshot !== null) observeRooms(environmentId, entry, snapshot.rooms);
      },
      { immediate: true },
    );
    entry.unsubscribe = () => {
      unsubscribeShell();
      unsubscribeRequests();
      unsubscribeDelegated();
      unsubscribeRooms();
      entry.gate.clear();
    };
    return entry;
  };

  const syncEnvironments = () => {
    const { notificationMode, inAppNotificationsEnabled } = getClientSettings();
    const enabled = notificationMode !== "off" || inAppNotificationsEnabled;
    const environmentIds = enabled ? registry.get(environmentSummaries.environmentIdsAtom) : [];
    const activeIds = new Set(environmentIds);
    for (const [environmentId, entry] of watched) {
      if (activeIds.has(environmentId)) continue;
      entry.unsubscribe();
      watched.delete(environmentId);
    }
    for (const environmentId of environmentIds) {
      if (!watched.has(environmentId)) watched.set(environmentId, watchEnvironment(environmentId));
    }
  };

  const pruneRemovedEnvironments = () => {
    const activeIds = new Set(registry.get(environmentSummaries.environmentIdsAtom));
    const count = pending.size;
    for (const [tag, entry] of pending) {
      if (activeIds.has(entry.environmentId)) continue;
      entry.notification.close();
      pending.delete(tag);
    }
    if (count !== pending.size) setNotificationBadge(pending.size);
  };

  // Listeners that only exist for some notification modes, rebuilt when the mode changes.
  let appliedMode: ClientSettings["notificationMode"] | null = null;
  let stopModeListeners = () => {};
  const applyMode = () => {
    const nextMode = getClientSettings().notificationMode;
    if (nextMode === appliedMode) return;
    appliedMode = nextMode;
    stopModeListeners();
    clearPending();
    const stops: Array<() => void> = [];
    if (hasDesktopNotifications(nextMode)) {
      const unsubscribeBadgeClear = window.desktopBridge?.onNotificationBadgeClear(clearPending);
      window.addEventListener("focus", clearPending);
      stops.push(() => {
        unsubscribeBadgeClear?.();
        window.removeEventListener("focus", clearPending);
        clearPending();
      });
    }
    if (hasNotificationSound(nextMode)) {
      document.addEventListener("pointerdown", unlockNotificationAudio);
      document.addEventListener("keydown", unlockNotificationAudio);
      stops.push(() => {
        document.removeEventListener("pointerdown", unlockNotificationAudio);
        document.removeEventListener("keydown", unlockNotificationAudio);
      });
    }
    stopModeListeners = () => {
      for (const stop of stops) stop();
    };
  };

  const onSettings = () => {
    applyMode();
    syncEnvironments();
  };
  const unsubscribeSettings = subscribeClientSettings(onSettings);
  const unsubscribeEnvironmentIds = registry.subscribe(
    environmentSummaries.environmentIdsAtom,
    () => {
      pruneRemovedEnvironments();
      syncEnvironments();
    },
  );
  const unsubscribeHidden = [
    registry.subscribe(environmentThreadShells.hiddenThreadKeysAtom, closeHiddenPending),
    registry.subscribe(environmentThreadShells.anyEnvironmentHidingAtom, closeHiddenPending),
    registry.subscribe(environmentThreadShells.threadRefsAtom, closeHiddenPending),
  ];
  onSettings();

  return () => {
    unsubscribeSettings();
    unsubscribeEnvironmentIds();
    for (const unsubscribe of unsubscribeHidden) unsubscribe();
    for (const entry of watched.values()) entry.unsubscribe();
    watched.clear();
    stopModeListeners();
  };
}
