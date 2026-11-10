import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  type ChatAttachment,
  type EnvironmentId,
  mentionedBots,
  type RoomId,
  roomMentionSegments,
  RoomMessageId,
} from "@t3tools/contracts";
import { useRef, useState } from "react";
import { Platform, Pressable, Text as NativeText, TextInput, View } from "react-native";

import { ComposerAttachmentStrip } from "../../components/ComposerAttachmentStrip";
import { ComposerActionButton } from "../../components/ComposerToolbar";
import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { Menu } from "../../components/ui/Menu";
import { prepareTurnAttachments } from "../../lib/attachmentUpload";
import {
  type DraftComposerAttachment,
  pickComposerFiles,
  pickComposerMedia,
  removePersistedComposerAttachmentFile,
} from "../../lib/composerImages";
import { uuidv4 } from "../../lib/uuid";
import {
  appendComposerDraftAttachments,
  clearComposerDraftContent,
  removeComposerDraftAttachment,
  replaceComposerDraftAttachments,
  setComposerDraftText,
  useComposerDraft,
} from "../../state/use-composer-drafts";
import { useEnvironmentServerConfig } from "../../state/entities";
import { roomEnvironment } from "../../state/rooms";
import { useAtomCommand } from "../../state/use-atom-command";
import { useScaledTextRole } from "../settings/appearance/useScaledTextRole";
import { ComposerAttachmentButton } from "../threads/ComposerAttachmentButton";
import {
  type ComposerCommandItem,
  ComposerCommandPopover,
} from "../threads/ComposerCommandPopover";
import { ComposerPopoverAnchor } from "../threads/ComposerPopoverAnchor";
import { ComposerSurface, THREAD_COMPOSER_BOTTOM_GUTTER } from "../threads/ThreadComposer";
import { roomDraftKey } from "./roomDrafts";
import {
  insertRoomMention,
  type RoomBot,
  roomMentionQuery,
  roomPostFailure,
} from "./roomPresentation";

const ROOM_MESSAGE_MAX_ATTACHMENTS = 8;

// The room claimed the uploads; only the local copies are ours to remove.
const discardLocalFiles = (attachments: ReadonlyArray<DraftComposerAttachment>) =>
  Promise.all(
    attachments.flatMap((attachment) =>
      attachment.fileUri ? [removePersistedComposerAttachmentFile(attachment.fileUri)] : [],
    ),
  );

/**
 * The thread composer's pill for a group chat: `@` offers the room's bots, the plus attaches
 * photos and files, and sending posts to the room. The draft is kept per room like a thread's.
 */
export function RoomComposer(props: {
  readonly environmentId: EnvironmentId;
  readonly roomId: RoomId;
  readonly roomTitle: string;
  readonly bots: ReadonlyArray<RoomBot>;
  /** Bots taking a turn; the stop button beside Send stops one, or offers a choice of several. */
  readonly working: ReadonlyArray<RoomBot>;
  readonly onStop: (bot: RoomBot) => void;
  readonly bottomInset: number;
  readonly contentMaxWidth: number | undefined;
}) {
  const post = useAtomCommand(roomEnvironment.post, { reportFailure: false });
  const serverConfig = useEnvironmentServerConfig(props.environmentId);
  const maxUploadBytes = serverConfig?.environment.capabilities.fileAttachments?.maxUploadBytes;
  const bodyText = useScaledTextRole("body");
  const draftKey = roomDraftKey(props.environmentId, props.roomId);
  const { text, attachments } = useComposerDraft(draftKey);
  // Until the caret moves, it sits after a saved draft's text, which can load after mounting.
  const [movedSelection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const selection = movedSelection ?? { start: text.length, end: text.length };
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [phase, setPhase] = useState<"idle" | "uploading" | "posting">("idle");
  const upload = useRef<AbortController | null>(null);
  // A retry of the same message reuses its id, so the room posts it once.
  const [pendingMessageId, setPendingMessageId] = useState<RoomMessageId | null>(null);
  const sending = phase !== "idle";

  const segments = roomMentionSegments(
    text,
    props.bots.map((bot) => bot.name),
  );

  const cursor = selection.end;
  const mention = selection.start === selection.end ? roomMentionQuery(text, cursor) : null;
  const items: ReadonlyArray<ComposerCommandItem> =
    mention === null || mention.start === dismissedAt
      ? []
      : props.bots
          .filter((bot) => bot.name.toLowerCase().startsWith(mention.query.toLowerCase()))
          .map((bot) => ({
            id: bot.projectId,
            type: "bot",
            avatar: bot.avatar,
            label: bot.name,
            description: "Ask it in the chat",
          }));

  const edit = (next: { readonly text: string; readonly cursor: number }) => {
    setComposerDraftText(draftKey, next.text);
    setSelection({ start: next.cursor, end: next.cursor });
    setPendingMessageId(null);
  };
  const pick = (item: ComposerCommandItem) => {
    if (mention === null) return;
    edit(insertRoomMention(text, mention, cursor, item.label));
  };
  const addAttachments = (picked: ReadonlyArray<DraftComposerAttachment>, error: string | null) => {
    const rejected = appendComposerDraftAttachments(draftKey, picked, {
      maxAttachments: ROOM_MESSAGE_MAX_ATTACHMENTS,
    });
    if (rejected < picked.length) setPendingMessageId(null);
    const problem =
      error ??
      (rejected > 0
        ? `You can attach up to ${ROOM_MESSAGE_MAX_ATTACHMENTS} files per message.`
        : null);
    if (problem !== null) Dialog.alert("Could not attach that", problem);
  };
  const removeAttachment = (id: string) => {
    removeComposerDraftAttachment(draftKey, id);
    setPendingMessageId(null);
  };

  const canSend = !sending && (text.trim() !== "" || attachments.length > 0);
  /** Uploads, then posts; resolves to "sent", "cancelled", or why it was not sent. */
  const deliver = async (
    body: string,
    sent: ReadonlyArray<DraftComposerAttachment>,
    messageId: RoomMessageId,
  ): Promise<"sent" | "cancelled" | { readonly failure: string }> => {
    const controller = new AbortController();
    upload.current = controller;
    setPhase(sent.length > 0 ? "uploading" : "posting");
    const prepared = await prepareTurnAttachments({
      environmentId: props.environmentId,
      attachments: sent,
      supportsImageUploads: true,
      signal: controller.signal,
    }).finally(() => {
      upload.current = null;
    });
    if (prepared.status !== "ready") return "cancelled";
    setPhase("posting");
    // Keep the uploaded ids so a retry reuses the bytes.
    replaceComposerDraftAttachments(draftKey, prepared.draftAttachments);
    // Every upload is by reference here; inline image data is for providers, not rooms.
    const uploaded: ReadonlyArray<ChatAttachment> = prepared.attachments.flatMap((attachment) =>
      "dataUrl" in attachment ? [] : [attachment],
    );
    const result = await post({
      environmentId: props.environmentId,
      input: {
        roomId: props.roomId,
        messageId,
        text: body,
        mentions: mentionedBots(body, props.bots),
        ...(uploaded.length > 0 ? { attachments: uploaded } : {}),
      },
    });
    return result._tag === "Success"
      ? "sent"
      : { failure: roomPostFailure(squashAtomCommandFailure(result)) };
  };

  const send = async () => {
    if (!canSend) return;
    const body = text.trim();
    const sent = attachments;
    const messageId = pendingMessageId ?? RoomMessageId.make(uuidv4());
    setPendingMessageId(messageId);
    const outcome = await deliver(body, sent, messageId).catch(
      (error: unknown) => ({ failure: roomPostFailure(error) }) as const,
    );
    setPhase("idle");
    if (outcome === "cancelled") return;
    if (outcome !== "sent") {
      Dialog.alert("Could not send", outcome.failure);
      return;
    }
    clearComposerDraftContent(draftKey, { deferAttachmentCleanup: true });
    setSelection(null);
    setPendingMessageId(null);
    void discardLocalFiles(sent);
  };

  return (
    <View
      className="px-[12px]"
      style={{ paddingTop: 6, paddingBottom: props.bottomInset + THREAD_COMPOSER_BOTTOM_GUTTER }}
    >
      <View
        className={
          Platform.OS === "android"
            ? "hidden"
            : "absolute inset-0 bg-linear-to-b from-screen/0 via-screen/60 to-screen/90"
        }
        pointerEvents="none"
      />
      <View className="relative w-full self-center" style={{ maxWidth: props.contentMaxWidth }}>
        {items.length > 0 ? (
          <ComposerPopoverAnchor>
            <ComposerCommandPopover
              items={items}
              triggerKind={null}
              isLoading={false}
              onSelect={pick}
            />
          </ComposerPopoverAnchor>
        ) : null}
        <ComposerSurface
          animateLayout={false}
          style={{
            borderRadius: 27,
            borderCurve: "circular",
            overflow: "hidden",
            paddingVertical: 2,
          }}
        >
          {attachments.length > 0 ? (
            <View className="px-[14px] pt-2.5 pb-1">
              <ComposerAttachmentStrip
                environmentId={props.environmentId}
                attachments={attachments}
                onRemove={sending ? () => undefined : removeAttachment}
                imageSize={56}
                imageBorderRadius={14}
              />
            </View>
          ) : null}
          <View className="flex-row items-end">
            <ComposerAttachmentButton
              disabled={sending}
              supportsFiles={maxUploadBytes !== undefined}
              onPickMedia={async () => {
                const result = await pickComposerMedia({
                  existingCount: attachments.length,
                  maxVideoBytes: maxUploadBytes,
                });
                addAttachments(result.attachments, result.error);
              }}
              onPickFiles={async () => {
                const result = await pickComposerFiles({
                  existingCount: attachments.length,
                  ...(maxUploadBytes === undefined ? {} : { maxBytes: maxUploadBytes }),
                });
                addAttachments(result.files, result.error);
              }}
            />
            <TextInput
              accessibilityLabel={`Message ${props.roomTitle}`}
              multiline
              editable={!sending}
              selection={selection}
              placeholder={
                props.bots[0] === undefined
                  ? `Message ${props.roomTitle}`
                  : `Message, or @${props.bots[0].name} to ask`
              }
              placeholderTextColorClassName="accent-placeholder"
              onChangeText={(next) => {
                setComposerDraftText(draftKey, next);
                setPendingMessageId(null);
                if (dismissedAt !== null && next.length <= dismissedAt) setDismissedAt(null);
              }}
              onSelectionChange={(event) => setSelection(event.nativeEvent.selection)}
              onKeyPress={(event) => {
                if (event.nativeEvent.key === "Escape" && mention !== null) {
                  setDismissedAt(mention.start);
                }
              }}
              className="min-w-0 flex-1 px-1 font-sans text-foreground"
              style={{
                fontSize: bodyText.fontSize,
                lineHeight: bodyText.lineHeight,
                minHeight: 44,
                maxHeight: bodyText.lineHeight * 6 + 20,
                paddingTop: 11,
                paddingBottom: 11,
                textAlignVertical: "center",
              }}
            >
              {/* The text as styled spans rather than `value`, so mentions can be coloured in place. */}
              <NativeText>
                {segments.map((segment) =>
                  segment.mention === undefined ? (
                    segment.text
                  ) : (
                    // Colour only: anything that changes glyph widths would move the caret.
                    <NativeText key={segment.start} className="bg-primary/10 text-primary-text">
                      {segment.text}
                    </NativeText>
                  ),
                )}
              </NativeText>
            </TextInput>
            <RoomStopButton working={props.working} onStop={props.onStop} />
            <ComposerActionButton
              accessibilityLabel="Send"
              icon="arrow.up"
              variant="primary"
              disabled={!canSend}
              onPress={() => void send()}
            />
          </View>
        </ComposerSurface>
        {phase === "uploading" ? (
          <View className="flex-row items-center justify-center gap-2 pt-1.5">
            <Text className="text-xs text-foreground-muted">Uploading…</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel upload"
              hitSlop={8}
              className="active:opacity-60"
              onPress={() => upload.current?.abort()}
            >
              <Text className="font-t3-medium text-xs text-foreground-secondary">Cancel</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function RoomStopButton(props: {
  readonly working: ReadonlyArray<RoomBot>;
  readonly onStop: (bot: RoomBot) => void;
}) {
  const [only, ...others] = props.working;
  if (only === undefined) return null;
  if (others.length === 0) {
    return (
      <ComposerActionButton
        accessibilityLabel={`Stop ${only.name}`}
        icon="stop.fill"
        variant="danger"
        onPress={() => props.onStop(only)}
      />
    );
  }
  return (
    <Menu
      accessible
      accessibilityLabel="Stop a bot"
      accessibilityRole="button"
      actions={props.working.map((bot) => ({
        id: bot.projectId,
        title: `Stop ${bot.name}`,
        image: "stop.fill",
        attributes: { destructive: true },
      }))}
      onPressAction={({ nativeEvent }) => {
        const bot = props.working.find((candidate) => candidate.projectId === nativeEvent.event);
        if (bot !== undefined) props.onStop(bot);
      }}
    >
      <ComposerActionButton accessibilityLabel="Stop a bot" icon="stop.fill" variant="danger" />
    </Menu>
  );
}
