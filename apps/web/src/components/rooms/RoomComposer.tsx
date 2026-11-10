import { useAtomValue } from "@effect/atom-react";
import { type EnvironmentId, mentionedBots, type RoomId, RoomMessageId } from "@t3tools/contracts";
import { PaperclipIcon, RotateCcwIcon, XIcon } from "lucide-react";
import {
  type ClipboardEvent,
  type DragEvent,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
} from "react";

import { isCommandPaletteOpen } from "~/commandPaletteBus";
import { composerSubmissionIntentForKey } from "~/composer-logic";
import { resolveShortcutCommand } from "~/keybindings";
import { DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { useClientSettings } from "~/hooks/useSettings";
import { useSoftwareKeyboardOpen } from "~/hooks/useSoftwareKeyboardOpen";
import { useTheme } from "~/hooks/useTheme";
import { cn, randomUUID } from "~/lib/utils";
import { roomEnvironment } from "../../state/rooms";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  type ComposerCommandItem,
  ComposerCommandMenu,
  composerSuggestionOptionId,
} from "../chat/ComposerCommandMenu";
import { ComposerCommandMenuLayer } from "../chat/ComposerCommandMenuLayer";
import { ComposerControl, ComposerControlIcon } from "../chat/ComposerControl";
import { ComposerPrimaryActions } from "../chat/ComposerPrimaryActions";
import { ComposerSurface } from "../chat/ComposerSurface";
import { PierreEntryIcon } from "../chat/PierreEntryIcon";
import { EMPTY_COMPOSER_CONTEXT_RECORDS } from "../composerContextPresentation";
import {
  type ComposerPromptEditorHandle,
  ComposerPromptEditorTiptap,
} from "../ComposerPromptEditorTiptap";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { roomMentionQuery } from "./roomMentions";
import type { RoomBot } from "./RoomTimeline";
import {
  clearSentRoomFiles,
  removeRoomFile,
  retryRoomFile,
  roomDraftKey,
  ROOM_MAX_FILES,
  type StagedFile,
  stageRoomFiles,
  useStagedRoomFiles,
} from "./roomUploads";

const NO_SKILLS: ReadonlyArray<never> = [];
const ignore = () => {};

/**
 * The thread composer's editor, menu and send button, for a group chat: `@` offers the room's
 * bots, and sending posts to the room. What is typed and attached stays with the room.
 */
export function RoomComposer(props: {
  readonly environmentId: EnvironmentId;
  readonly roomId: RoomId;
  readonly roomTitle: string;
  readonly bots: ReadonlyArray<RoomBot>;
  readonly working: ReadonlyArray<RoomBot>;
}) {
  const { environmentId } = props;
  const post = useAtomCommand(roomEnvironment.post, "Could not send");
  const interrupt = useAtomCommand(roomEnvironment.interrupt, "Could not stop the bot");
  const canOperate = useAtomValue(roomEnvironment.interrupt.permissionAtom(environmentId));
  const onlyWorking = props.working.length === 1 ? props.working[0]! : null;
  const stop = (projectId: string) => {
    const bot = props.working.find((candidate) => candidate.projectId === projectId);
    if (bot === undefined || !canOperate) return;
    return interrupt({
      environmentId,
      input: { roomId: props.roomId, projectId: bot.projectId },
    });
  };
  const draftKey = roomDraftKey(environmentId, props.roomId);
  const draftTarget = DraftId.make(draftKey);
  const value = useComposerDraftStore((state) => state.draftsByThreadKey[draftKey]?.prompt ?? "");
  const setValue = (prompt: string) =>
    useComposerDraftStore.getState().setPrompt(draftTarget, prompt);
  const staged = useStagedRoomFiles(draftKey);
  const editorRef = useRef<ComposerPromptEditorHandle | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [cursor, setCursor] = useState(() => value.length);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // One id per message until it lands, so a retry after a dropped reply posts it once.
  const pendingMessageId = useRef<RoomMessageId | null>(null);
  const listId = `${useId()}-room-mentions`;
  const { resolvedTheme } = useTheme();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const sendShortcut = useClientSettings((settings) => settings.sendShortcut);
  const isSoftwareKeyboardOpen = useSoftwareKeyboardOpen();
  // A thread's stop chord stops the room's bot only while one is working; with several it is
  // unclear which, so the key passes through.
  const onStopShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (onlyWorking === null || !canOperate || event.defaultPrevented || isCommandPaletteOpen()) {
      return;
    }
    const command = resolveShortcutCommand(event, keybindings, {
      context: { turnRunning: true },
    });
    if (command !== "thread.stop") return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) void stop(onlyWorking.projectId);
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- listens on the window for the stop chord, as the thread view does
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => onStopShortcut(event);
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  const botNames = props.bots.map((bot) => bot.name);
  const mention = roomMentionQuery(value.slice(0, cursor), botNames);
  const queryStart = mention?.start ?? null;
  const items: Array<ComposerCommandItem> =
    mention === null || queryStart === dismissedAt
      ? []
      : props.bots
          .filter((bot) => bot.name.toLowerCase().startsWith(mention.query.toLowerCase()))
          .map((bot) => ({
            id: bot.projectId,
            type: "bot",
            projectId: bot.projectId,
            avatar: bot.avatar,
            label: bot.name,
            description: "Ask it in the chat",
          }));
  const active = items.find((item) => item.id === highlightedId) ?? items[0] ?? null;

  const pick = (item: ComposerCommandItem) => {
    if (queryStart === null) return;
    const insert = `@${item.label} `;
    const next = value.slice(0, queryStart) + insert + value.slice(cursor);
    const nextCursor = queryStart + insert.length;
    setValue(next);
    setCursor(nextCursor);
    setHighlightedId(null);
    // As in the thread composer: the editor takes the new value on commit, then the caret.
    window.requestAnimationFrame(() => editorRef.current?.focusAt(nextCursor));
  };

  const addFiles = (files: ReadonlyArray<File>) => {
    if (files.length === 0) return;
    const left = stageRoomFiles(environmentId, props.roomId, files);
    if (left > 0) {
      toastManager.add({
        type: "warning",
        title: `A message can carry ${ROOM_MAX_FILES} files`,
        description: left === 1 ? "One file was not attached." : `${left} files were not attached.`,
      });
    }
  };

  const uploading = staged.some((entry) => entry.attachment === null && entry.error === null);
  const failed = staged.some((entry) => entry.error !== null);
  const ready = staged.flatMap((entry) => (entry.attachment === null ? [] : [entry.attachment]));
  const sendDisabledReason = failed ? "Retry or remove the files that didn't upload" : null;
  const canSend = !sending && !uploading && !failed && (value.trim() !== "" || ready.length > 0);

  const send = async () => {
    const text = value.trim();
    if (!canSend) return;
    setSending(true);
    if (pendingMessageId.current === null) {
      pendingMessageId.current = RoomMessageId.make(randomUUID());
    }
    const sentKeys = staged.map((entry) => entry.key);
    const result = await post({
      environmentId,
      input: {
        roomId: props.roomId,
        messageId: pendingMessageId.current,
        text,
        mentions: mentionedBots(text, props.bots),
        attachments: ready,
      },
    });
    setSending(false);
    if (result._tag !== "Success") return;
    pendingMessageId.current = null;
    // Keep anything typed or attached while the post was in flight.
    const current = useComposerDraftStore.getState().draftsByThreadKey[draftKey]?.prompt ?? "";
    if (current.trim() === text) {
      setValue("");
      setCursor(0);
    }
    clearSentRoomFiles(draftKey, sentKeys);
  };

  const onPaste = (event: ClipboardEvent<HTMLElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (files.length === 0) return;
    // As in the thread composer: images attach; other files only when no text came along.
    const hasImage = files.some((file) => file.type.startsWith("image/"));
    if (!hasImage && event.clipboardData.getData("text/plain") !== "") return;
    event.preventDefault();
    addFiles(files);
  };

  const onDrop = (event: DragEvent<HTMLFormElement>) => {
    setDragging(false);
    if (event.dataTransfer.files.length === 0) return;
    event.preventDefault();
    addFiles(Array.from(event.dataTransfer.files));
  };

  const onCommandKeyDown = (key: string, event: KeyboardEvent) => {
    const intent = composerSubmissionIntentForKey({
      event,
      keybindings,
      isSoftwareKeyboardOpen,
      isDraftThread: false,
      sendShortcut,
      prompt: value,
    });
    if (items.length > 0 && (intent === null || intent === "foreground")) {
      if (key === "ArrowDown" || key === "ArrowUp") {
        const index = active === null ? -1 : items.indexOf(active);
        const step = key === "ArrowDown" ? 1 : -1;
        setHighlightedId(items[(index + step + items.length) % items.length]!.id);
        return true;
      }
      if ((key === "Enter" || key === "Tab") && active !== null) {
        pick(active);
        return true;
      }
      if (key === "Escape") {
        setDismissedAt(queryStart);
        return true;
      }
    }
    if (intent !== null && key === "Enter") {
      void send();
      return true;
    }
    return false;
  };

  return (
    <ComposerSurface.Shell>
      <ComposerSurface.Host>
        <form
          data-chat-composer-form="true"
          className="relative z-10"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes("Files")) return;
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <ComposerSurface.Main>
            <div
              className={cn(
                "rounded-2xl transition-[background-color] duration-200",
                dragging && "bg-accent/45 ring-1 ring-inset ring-primary/70",
              )}
              data-chat-composer-surface="true"
            >
              <div
                ref={setMenuAnchor}
                data-chat-composer-body="true"
                className="relative px-4 pt-3.5 pb-2 sm:pt-4"
              >
                {staged.length > 0 ? (
                  <ul aria-label="Attached files" className="mb-2.5 flex flex-wrap gap-2">
                    {staged.map((entry) => (
                      <StagedFileChip
                        key={entry.key}
                        entry={entry}
                        resolvedTheme={resolvedTheme}
                        onRetry={() => retryRoomFile(draftKey, environmentId, entry.key)}
                        onRemove={() => removeRoomFile(draftKey, environmentId, entry.key)}
                      />
                    ))}
                  </ul>
                ) : null}
                {items.length > 0 ? (
                  <ComposerCommandMenuLayer anchor={menuAnchor}>
                    <ComposerCommandMenu
                      listId={listId}
                      items={items}
                      resolvedTheme={resolvedTheme}
                      isLoading={false}
                      triggerKind={null}
                      activeItemId={active?.id ?? null}
                      onHighlightedItemChange={setHighlightedId}
                      onSelect={pick}
                    />
                  </ComposerCommandMenuLayer>
                ) : null}
                <ComposerPromptEditorTiptap
                  draftKey={draftKey}
                  ariaLabel={`Message ${props.roomTitle}`}
                  suggestionListId={listId}
                  activeSuggestionId={
                    active === null ? undefined : composerSuggestionOptionId(listId, active.id)
                  }
                  editorRef={editorRef}
                  // A room has no files or skills to chip; `@Name` must stay the text it is.
                  literalText
                  value={value}
                  cursor={cursor}
                  contextRecords={EMPTY_COMPOSER_CONTEXT_RECORDS}
                  skills={NO_SKILLS}
                  mentionNames={botNames}
                  disabled={false}
                  placeholder={
                    props.bots[0] === undefined
                      ? `Message ${props.roomTitle}`
                      : `Message, or @${props.bots[0].name} to ask a bot`
                  }
                  onChange={(nextValue, _cursor, expandedCursor) => {
                    setValue(nextValue);
                    setCursor(expandedCursor);
                    if (dismissedAt !== null && nextValue.length < dismissedAt) {
                      setDismissedAt(null);
                    }
                  }}
                  onCommandKeyDown={onCommandKeyDown}
                  onPaste={onPaste}
                />
              </div>
              <div
                data-chat-composer-footer="true"
                className="flex min-w-0 flex-nowrap items-center px-2 pb-2"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  hidden
                  aria-label="Files to attach"
                  onChange={(event) => {
                    addFiles(Array.from(event.target.files ?? []));
                    // The same file can be picked again after it is removed.
                    event.target.value = "";
                  }}
                />
                <ComposerControl
                  aria-label="Attach files"
                  disabled={staged.length >= ROOM_MAX_FILES}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ComposerControlIcon icon={PaperclipIcon} />
                </ComposerControl>
                <div className="flex-1" />
                <ComposerPrimaryActions
                  compact={false}
                  canOperateThread={canOperate}
                  pendingAction={null}
                  isRunning={false}
                  canInterrupt={props.working.length > 0}
                  interruptLabel={onlyWorking === null ? "Stop a bot" : `Stop ${onlyWorking.name}`}
                  interruptChoices={props.working.map((bot) => ({
                    key: bot.projectId,
                    label: `Stop ${bot.name}`,
                  }))}
                  onInterruptChoice={(projectId) => void stop(projectId)}
                  showPlanFollowUpPrompt={false}
                  promptHasText={value.trim() !== ""}
                  isSendBusy={sending || uploading}
                  sendDisabledReason={sendDisabledReason}
                  isEnvironmentUnavailable={false}
                  isPreparingWorktree={false}
                  hasSendableContent={value.trim() !== "" || ready.length > 0}
                  onPreviousPendingQuestion={ignore}
                  onInterrupt={() => {
                    if (onlyWorking !== null) void stop(onlyWorking.projectId);
                  }}
                  onImplementPlanInNewThread={ignore}
                />
              </div>
            </div>
          </ComposerSurface.Main>
        </form>
      </ComposerSurface.Host>
    </ComposerSurface.Shell>
  );
}

/** A staged image's thumbnail; its object URL lives as long as the element. */
function StagedImage({ file }: { readonly file: File }) {
  return (
    <img
      alt={file.name}
      className="size-full object-cover"
      ref={(image) => {
        if (!image) return;
        const url = URL.createObjectURL(file);
        image.src = url;
        return () => URL.revokeObjectURL(url);
      }}
    />
  );
}

function StagedFileChip(props: {
  readonly entry: StagedFile;
  readonly resolvedTheme: "light" | "dark";
  readonly onRetry: () => void;
  readonly onRemove: () => void;
}) {
  const { entry } = props;
  const isImage = entry.file.type.startsWith("image/");
  const pending = entry.attachment === null && entry.error === null;
  const chip = (
    <li
      className={cn(
        "relative flex h-14 min-w-0 items-center gap-2 overflow-hidden rounded-lg border bg-background/70 pe-1",
        entry.error !== null ? "border-destructive/60" : "border-border/80",
      )}
      aria-label={
        entry.error !== null
          ? `${entry.file.name} could not be uploaded: ${entry.error}`
          : entry.file.name
      }
    >
      {isImage ? (
        <span className={cn("size-14 shrink-0", (pending || entry.error !== null) && "opacity-60")}>
          <StagedImage file={entry.file} />
        </span>
      ) : (
        <span className="flex min-w-0 items-center gap-2 ps-2 text-sm">
          <PierreEntryIcon pathValue={entry.file.name} kind="file" theme={props.resolvedTheme} />
          <span className="max-w-40 truncate">{entry.file.name}</span>
        </span>
      )}
      {pending ? (
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-0.5 bg-primary/70 transition-[width] duration-150"
          style={{ width: `${Math.round(entry.progress * 100)}%` }}
        />
      ) : null}
      {entry.error !== null ? (
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label={`Retry ${entry.file.name}`}
          onClick={props.onRetry}
        >
          <RotateCcwIcon />
        </Button>
      ) : null}
      <Button
        size="icon-xs"
        variant="ghost-muted"
        aria-label={`Remove ${entry.file.name}`}
        onClick={props.onRemove}
      >
        <XIcon />
      </Button>
    </li>
  );
  return entry.error === null ? (
    chip
  ) : (
    <Tooltip>
      <TooltipTrigger render={chip} />
      <TooltipPopup side="top">{`Didn't upload: ${entry.error}`}</TooltipPopup>
    </Tooltip>
  );
}
