import { useAtomValue } from "@effect/atom-react";
import {
  type ChatAttachment,
  type EnvironmentId,
  mentionedBots,
  type RoomId,
  RoomMessageId,
} from "@t3tools/contracts";
import { PaperclipIcon, XIcon } from "lucide-react";
import { type ClipboardEvent, type DragEvent, useId, useRef, useState } from "react";

import { composerSubmissionIntentForKey } from "~/composer-logic";
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
import { PierreEntryIcon } from "../chat/PierreEntryIcon";
import { Button } from "../ui/button";
import { uploadRoomFile } from "./roomUploads";
import { ComposerPrimaryActions } from "../chat/ComposerPrimaryActions";
import { ComposerSurface } from "../chat/ComposerSurface";
import { EMPTY_COMPOSER_CONTEXT_RECORDS } from "../composerContextPresentation";
import {
  type ComposerPromptEditorHandle,
  ComposerPromptEditorTiptap,
} from "../ComposerPromptEditorTiptap";
import type { RoomBot } from "./RoomTimeline";

/** `@partial` right before the caret: the bots whose names start with it are offered. */
const MENTION_QUERY = /(?:^|\s)@([\p{L}\p{N}_-]*)$/u;
const NO_SKILLS: ReadonlyArray<never> = [];
const MAX_FILES = 8;

/** A file on its way into the next message: uploading, ready to send, or failed. */
interface StagedFile {
  readonly key: string;
  readonly file: File;
  readonly progress: number;
  readonly attachment: ChatAttachment | null;
  readonly failed: boolean;
}
const ignore = () => {};

/**
 * The thread composer's editor, menu and send button, for a group chat: `@` offers the room's
 * bots, and sending posts to the room.
 */
export function RoomComposer(props: {
  readonly environmentId: EnvironmentId;
  readonly roomId: RoomId;
  readonly roomTitle: string;
  readonly bots: ReadonlyArray<RoomBot>;
}) {
  const post = useAtomCommand(roomEnvironment.post, "Could not send");
  const editorRef = useRef<ComposerPromptEditorHandle | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [value, setValue] = useState("");
  const [cursor, setCursor] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [staged, setStaged] = useState<ReadonlyArray<StagedFile>>([]);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nextKey = useRef(0);
  // One id per message until it lands, so a retry after a dropped reply posts it once.
  const pendingMessageId = useRef<RoomMessageId | null>(null);
  const listId = `${useId()}-room-mentions`;
  const { resolvedTheme } = useTheme();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const sendShortcut = useClientSettings((settings) => settings.sendShortcut);
  const richTextEnabled = useClientSettings((settings) => settings.composerRichTextEnabled);
  const isSoftwareKeyboardOpen = useSoftwareKeyboardOpen();

  const match = MENTION_QUERY.exec(value.slice(0, cursor));
  const query = match === null ? null : match[1]!;
  const queryStart = match === null ? null : cursor - query!.length - 1;
  const items: Array<ComposerCommandItem> =
    query === null || queryStart === dismissedAt
      ? []
      : props.bots
          .filter((bot) => bot.name.toLowerCase().startsWith(query.toLowerCase()))
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

  const updateStaged = (key: string, change: Partial<StagedFile>) =>
    setStaged((current) =>
      current.map((entry) => (entry.key === key ? { ...entry, ...change } : entry)),
    );

  const addFiles = (files: ReadonlyArray<File>) => {
    const room = MAX_FILES - staged.length;
    for (const file of files.slice(0, Math.max(room, 0))) {
      const key = `staged-${nextKey.current++}`;
      setStaged((current) => [
        ...current,
        { key, file, progress: 0, attachment: null, failed: false },
      ]);
      uploadRoomFile({
        environmentId: props.environmentId,
        file,
        onProgress: (progress) => updateStaged(key, { progress }),
      }).then(
        (attachment) => updateStaged(key, { attachment, progress: 1 }),
        () => updateStaged(key, { failed: true }),
      );
    }
  };

  const uploading = staged.some((entry) => entry.attachment === null && !entry.failed);
  const ready = staged.flatMap((entry) => (entry.attachment === null ? [] : [entry.attachment]));
  const canSend = !sending && !uploading && (value.trim() !== "" || ready.length > 0);

  const send = async () => {
    const text = value.trim();
    if (!canSend) return;
    setSending(true);
    if (pendingMessageId.current === null) {
      pendingMessageId.current = RoomMessageId.make(randomUUID());
    }
    const sentFiles = staged;
    const result = await post({
      environmentId: props.environmentId,
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
    setValue((current) => (current.trim() === text ? "" : current));
    setCursor(0);
    setStaged((current) => current.filter((entry) => !sentFiles.includes(entry)));
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
                        onRemove={() =>
                          setStaged((current) =>
                            current.filter((candidate) => candidate.key !== entry.key),
                          )
                        }
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
                  draftKey={`room:${props.roomId}`}
                  ariaLabel={`Message ${props.roomTitle}`}
                  suggestionListId={listId}
                  activeSuggestionId={
                    active === null ? undefined : composerSuggestionOptionId(listId, active.id)
                  }
                  editorRef={editorRef}
                  richTextEnabled={richTextEnabled}
                  value={value}
                  cursor={cursor}
                  contextRecords={EMPTY_COMPOSER_CONTEXT_RECORDS}
                  skills={NO_SKILLS}
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
                  disabled={staged.length >= MAX_FILES}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ComposerControlIcon icon={PaperclipIcon} />
                </ComposerControl>
                <div className="flex-1" />
                <ComposerPrimaryActions
                  compact={false}
                  canOperateThread
                  pendingAction={null}
                  isRunning={false}
                  canInterrupt={false}
                  showPlanFollowUpPrompt={false}
                  promptHasText={value.trim() !== ""}
                  isSendBusy={sending || uploading}
                  sendDisabledReason={null}
                  isEnvironmentUnavailable={false}
                  isPreparingWorktree={false}
                  hasSendableContent={value.trim() !== "" || ready.length > 0}
                  onPreviousPendingQuestion={ignore}
                  onInterrupt={ignore}
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
  readonly onRemove: () => void;
}) {
  const { entry } = props;
  const isImage = entry.file.type.startsWith("image/");
  const pending = entry.attachment === null && !entry.failed;
  return (
    <li
      className={cn(
        "relative flex h-14 min-w-0 items-center gap-2 overflow-hidden rounded-lg border bg-background/70 pe-1",
        entry.failed ? "border-destructive/60" : "border-border/80",
      )}
      aria-label={entry.failed ? `${entry.file.name} could not be uploaded` : entry.file.name}
    >
      {isImage ? (
        <span className={cn("size-14 shrink-0", pending && "opacity-60")}>
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
}
