import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import {
  deletePendingAttachmentUpload,
  runAttachmentUploadCycle,
} from "@t3tools/client-runtime/state/attachments";
import {
  type ChatAttachment,
  ChatAttachmentId,
  type EnvironmentId,
  PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPES,
  type RoomId,
  type RoomSummary,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { create } from "zustand";

import { DraftId, useComposerDraftStore } from "../../composerDraftStore";
import { uploadBytes } from "../../lib/attachmentUploadQueue";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { attachmentEnvironment } from "../../state/attachments";
import { roomEnvironment } from "../../state/rooms";
import { readPreparedConnection } from "../../state/session";

/** Where a room's unsent text and files are kept; machines can share room ids. */
export const roomDraftKey = (environmentId: EnvironmentId, roomId: RoomId) =>
  `room:${environmentId}:${roomId}`;

const IMAGE_TYPES: ReadonlySet<string> = new Set(PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPES);
/** What one room message may carry; the server refuses more. */
export const ROOM_MAX_FILES = 8;

type UploadOutcome =
  | { readonly status: "uploaded"; readonly attachment: ChatAttachment }
  | { readonly status: "cancelled" }
  | { readonly status: "failed"; readonly reason: string };

function failureReason(step: string, error: unknown): string {
  if (step === "resolve-url") return "Not connected to that machine.";
  if (error instanceof Error && error.message.trim() !== "") return error.message;
  return "Upload failed.";
}

/**
 * Uploads one file for a group chat message and returns it as the room's post expects: a pending
 * attachment the room claims when the message is sent. Aborting the signal stops it and forgets
 * whatever reached the server.
 */
async function uploadRoomFile(input: {
  readonly environmentId: EnvironmentId;
  readonly file: File;
  readonly signal: AbortSignal;
  readonly onProgress: (progress: number) => void;
}): Promise<UploadOutcome> {
  const mimeType = input.file.type || "application/octet-stream";
  const image = IMAGE_TYPES.has(mimeType);
  const result = await runAttachmentUploadCycle({
    registry: appAtomRegistry,
    createUploadUrl: attachmentEnvironment.createUploadUrl,
    remove: attachmentEnvironment.remove,
    environmentId: input.environmentId,
    upload: {
      ...(image ? {} : { type: "file" as const }),
      name: input.file.name,
      mimeType,
      sizeBytes: input.file.size,
    },
    resolveUploadUrl: (relativeUrl) => {
      const connection = readPreparedConnection(input.environmentId);
      return connection ? resolveAssetUrl(connection.httpBaseUrl, relativeUrl) : null;
    },
    transport: (url) =>
      uploadBytes({ url, file: input.file, mimeType, onProgress: input.onProgress }),
    onMinted: () => (input.signal.aborted ? "cancel" : "continue"),
    onTransferStart: (abort) => {
      if (input.signal.aborted) abort();
      else input.signal.addEventListener("abort", abort, { once: true });
    },
  });
  if (result.status === "cancelled") return { status: "cancelled" };
  if (result.status === "failed") {
    if (result.attachmentId !== null) forgetUpload(input.environmentId, result.attachmentId);
    return input.signal.aborted
      ? { status: "cancelled" }
      : { status: "failed", reason: failureReason(result.step, result.error) };
  }
  if (input.signal.aborted) {
    forgetUpload(input.environmentId, result.attachmentId);
    return { status: "cancelled" };
  }
  const base = {
    id: ChatAttachmentId.make(result.attachmentId),
    name: input.file.name,
    sizeBytes: input.file.size,
  };
  return {
    status: "uploaded",
    attachment: image
      ? ({ ...base, type: "image", mimeType } as ChatAttachment)
      : ({ ...base, type: "file", mimeType } as ChatAttachment),
  };
}

function forgetUpload(environmentId: EnvironmentId, attachmentId: string) {
  deletePendingAttachmentUpload({
    registry: appAtomRegistry,
    remove: attachmentEnvironment.remove,
    environmentId,
    attachmentId,
  });
}

/** A file on its way into the next message: uploading, ready to send, or failed with a reason. */
export interface StagedFile {
  readonly key: string;
  readonly file: File;
  readonly progress: number;
  readonly attachment: ChatAttachment | null;
  readonly error: string | null;
}

interface StagedUpload extends StagedFile {
  readonly environmentId: EnvironmentId;
  readonly roomId: RoomId;
  readonly controller: AbortController;
}

const NO_FILES: ReadonlyArray<StagedUpload> = [];

// Files stay staged per room while the app is open, so leaving a room and coming back keeps
// them; uploads finish in the background meanwhile.
const useStaged = create<{
  readonly byRoom: Readonly<Record<string, ReadonlyArray<StagedUpload>>>;
}>(() => ({ byRoom: {} }));
let nextKey = 0;

function updateRoom(
  draftKey: string,
  change: (files: ReadonlyArray<StagedUpload>) => ReadonlyArray<StagedUpload>,
) {
  useStaged.setState((state) => {
    const next = change(state.byRoom[draftKey] ?? NO_FILES);
    const byRoom = { ...state.byRoom };
    if (next.length === 0) delete byRoom[draftKey];
    else byRoom[draftKey] = next;
    return { byRoom };
  });
}

function patchFile(draftKey: string, key: string, patch: Partial<StagedUpload>) {
  updateRoom(draftKey, (files) =>
    files.map((entry) => (entry.key === key ? { ...entry, ...patch } : entry)),
  );
}

function startUpload(draftKey: string, environmentId: EnvironmentId, entry: StagedUpload) {
  void uploadRoomFile({
    environmentId,
    file: entry.file,
    signal: entry.controller.signal,
    onProgress: (progress) => patchFile(draftKey, entry.key, { progress }),
  }).then((outcome) => {
    if (outcome.status === "uploaded") {
      patchFile(draftKey, entry.key, { attachment: outcome.attachment, progress: 1 });
    } else if (outcome.status === "failed") {
      patchFile(draftKey, entry.key, { error: outcome.reason });
    }
  });
}

export function useStagedRoomFiles(draftKey: string): ReadonlyArray<StagedFile> {
  return useStaged((state) => state.byRoom[draftKey] ?? NO_FILES);
}

/** Rooms with staged files that the list no longer shows the viewer in: deleted, or left. */
export function roomsWithoutViewer(
  staged: ReadonlyArray<RoomId>,
  rooms: ReadonlyArray<Pick<RoomSummary, "id" | "joined">>,
): ReadonlyArray<RoomId> {
  const kept = new Set(rooms.flatMap((room) => (room.joined ? [room.id] : [])));
  return staged.filter((roomId) => !kept.has(roomId));
}

const stagedRoomsOn = (environmentId: EnvironmentId) =>
  Object.values(useStaged.getState().byRoom).flatMap((files) =>
    files[0]?.environmentId === environmentId ? [files[0].roomId] : [],
  );

const listWatchers = new Map<EnvironmentId, () => void>();

/** Releases a machine's staged files once their room leaves its list, while any are staged. */
function watchRoomList(environmentId: EnvironmentId) {
  if (listWatchers.has(environmentId)) return;
  const stop = appAtomRegistry.subscribe(
    roomEnvironment.rooms({ environmentId, input: {} }),
    (result) => {
      const snapshot = AsyncResult.getOrElse(result, () => null);
      if (snapshot === null) return;
      for (const roomId of roomsWithoutViewer(stagedRoomsOn(environmentId), snapshot.rooms)) {
        discardRoomFiles(environmentId, roomId);
      }
      if (stagedRoomsOn(environmentId).length > 0) return;
      listWatchers.get(environmentId)?.();
      listWatchers.delete(environmentId);
    },
  );
  listWatchers.set(environmentId, stop);
}

/** Stages and uploads files, up to what a message may carry; returns how many did not fit. */
export function stageRoomFiles(
  environmentId: EnvironmentId,
  roomId: RoomId,
  files: ReadonlyArray<File>,
): number {
  const draftKey = roomDraftKey(environmentId, roomId);
  const current = useStaged.getState().byRoom[draftKey] ?? NO_FILES;
  const fitting = files.slice(0, Math.max(ROOM_MAX_FILES - current.length, 0));
  const added = fitting.map((file): StagedUpload => ({
    key: `staged-${nextKey++}`,
    file,
    progress: 0,
    attachment: null,
    error: null,
    environmentId,
    roomId,
    controller: new AbortController(),
  }));
  updateRoom(draftKey, (existing) => [...existing, ...added]);
  for (const entry of added) startUpload(draftKey, environmentId, entry);
  if (added.length > 0) watchRoomList(environmentId);
  return files.length - fitting.length;
}

export function retryRoomFile(draftKey: string, environmentId: EnvironmentId, key: string) {
  const entry = useStaged.getState().byRoom[draftKey]?.find((candidate) => candidate.key === key);
  if (entry === undefined || entry.error === null) return;
  const retried: StagedUpload = {
    ...entry,
    progress: 0,
    error: null,
    controller: new AbortController(),
  };
  patchFile(draftKey, key, retried);
  startUpload(draftKey, environmentId, retried);
}

/** Unstages a file: an upload in flight stops, and one that landed is forgotten on the server. */
export function removeRoomFile(draftKey: string, environmentId: EnvironmentId, key: string) {
  const entry = useStaged.getState().byRoom[draftKey]?.find((candidate) => candidate.key === key);
  if (entry === undefined) return;
  entry.controller.abort();
  if (entry.attachment !== null) forgetUpload(environmentId, entry.attachment.id);
  updateRoom(draftKey, (files) => files.filter((candidate) => candidate.key !== key));
}

/** Drops the draft of a room the viewer left, or that is gone: its text and staged files. */
export function discardRoomFiles(environmentId: EnvironmentId, roomId: RoomId) {
  const draftKey = roomDraftKey(environmentId, roomId);
  for (const entry of useStaged.getState().byRoom[draftKey] ?? NO_FILES) {
    entry.controller.abort();
    if (entry.attachment !== null) forgetUpload(environmentId, entry.attachment.id);
  }
  updateRoom(draftKey, () => NO_FILES);
  useComposerDraftStore.getState().setPrompt(DraftId.make(draftKey), "");
}

/** Drops files a post carried; the room owns them now. */
export function clearSentRoomFiles(draftKey: string, keys: ReadonlyArray<string>) {
  updateRoom(draftKey, (files) => files.filter((entry) => !keys.includes(entry.key)));
}
