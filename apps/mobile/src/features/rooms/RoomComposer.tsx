import {
  type ChatAttachment,
  type EnvironmentId,
  mentionedBots,
  type RoomId,
  RoomMessageId,
} from "@t3tools/contracts";
import { useState } from "react";
import { Platform, TextInput, View } from "react-native";

import { ComposerAttachmentStrip } from "../../components/ComposerAttachmentStrip";
import { ComposerActionButton } from "../../components/ComposerToolbar";
import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { prepareTurnAttachments } from "../../lib/attachmentUpload";
import {
  type DraftComposerAttachment,
  pickComposerFiles,
  pickComposerMedia,
  removePersistedComposerAttachmentFile,
} from "../../lib/composerImages";
import { uuidv4 } from "../../lib/uuid";
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
import { insertRoomMention, type RoomBot, roomMentionQuery } from "./roomPresentation";

const ROOM_MESSAGE_MAX_ATTACHMENTS = 8;

const discardFiles = (attachments: ReadonlyArray<DraftComposerAttachment>) =>
  Promise.all(
    attachments.flatMap((attachment) =>
      attachment.type === "file" && attachment.fileUri
        ? [removePersistedComposerAttachmentFile(attachment.fileUri)]
        : [],
    ),
  );

/**
 * The thread composer's pill for a group chat: `@` offers the room's bots, the plus attaches
 * photos and files, and sending posts to the room.
 */
export function RoomComposer(props: {
  readonly environmentId: EnvironmentId;
  readonly roomId: RoomId;
  readonly roomTitle: string;
  readonly bots: ReadonlyArray<RoomBot>;
  readonly bottomInset: number;
  readonly contentMaxWidth: number | undefined;
}) {
  const post = useAtomCommand(roomEnvironment.post, { reportFailure: false });
  const serverConfig = useEnvironmentServerConfig(props.environmentId);
  const maxUploadBytes = serverConfig?.environment.capabilities.fileAttachments?.maxUploadBytes;
  const bodyText = useScaledTextRole("body");
  const [text, setText] = useState("");
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [attachments, setAttachments] = useState<ReadonlyArray<DraftComposerAttachment>>([]);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  // A retry of the same message reuses its id, so the room posts it once.
  const [pendingMessageId, setPendingMessageId] = useState<RoomMessageId | null>(null);

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
    setText(next.text);
    setSelection({ start: next.cursor, end: next.cursor });
    setPendingMessageId(null);
  };
  const pick = (item: ComposerCommandItem) => {
    if (mention === null) return;
    edit(insertRoomMention(text, mention, cursor, item.label));
  };
  const addAttachments = (picked: ReadonlyArray<DraftComposerAttachment>, error: string | null) => {
    const room = ROOM_MESSAGE_MAX_ATTACHMENTS - attachments.length;
    const accepted = picked.slice(0, Math.max(0, room));
    void discardFiles(picked.slice(accepted.length));
    if (accepted.length > 0) {
      setAttachments((current) => [...current, ...accepted]);
      setPendingMessageId(null);
    }
    const problem =
      error ??
      (accepted.length < picked.length
        ? `You can attach up to ${ROOM_MESSAGE_MAX_ATTACHMENTS} files per message.`
        : null);
    if (problem !== null) Dialog.alert("Could not attach that", problem);
  };
  const removeAttachment = (id: string) => {
    void discardFiles(attachments.filter((attachment) => attachment.id === id));
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
    setPendingMessageId(null);
  };

  const canSend = !sending && (text.trim() !== "" || attachments.length > 0);
  /** Uploads, then posts; resolves to null once sent, or to why it was not. */
  const deliver = async (
    body: string,
    sent: ReadonlyArray<DraftComposerAttachment>,
    messageId: RoomMessageId,
  ): Promise<string | null> => {
    const prepared = await prepareTurnAttachments({
      environmentId: props.environmentId,
      attachments: sent,
      supportsImageUploads: true,
    });
    if (prepared.status !== "ready") return "The upload was cancelled.";
    // Keep the uploaded ids so a retry reuses the bytes.
    setAttachments(prepared.draftAttachments);
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
    return result._tag === "Success" ? null : "Check the connection and try again.";
  };

  const send = async () => {
    if (!canSend) return;
    const body = text.trim();
    const sent = attachments;
    const messageId = pendingMessageId ?? RoomMessageId.make(uuidv4());
    setPendingMessageId(messageId);
    setSending(true);
    const failure = await deliver(body, sent, messageId).catch((error: unknown) =>
      error instanceof Error ? error.message : "Check the connection and try again.",
    );
    setSending(false);
    if (failure !== null) {
      Dialog.alert("Could not send", failure);
      return;
    }
    // Keep anything typed while the post was in flight.
    setText((current) => (current.trim() === body ? "" : current));
    setSelection({ start: 0, end: 0 });
    setAttachments([]);
    setPendingMessageId(null);
    void discardFiles(sent);
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
              value={text}
              selection={selection}
              placeholder={
                props.bots[0] === undefined
                  ? `Message ${props.roomTitle}`
                  : `Message, or @${props.bots[0].name} to ask`
              }
              placeholderTextColorClassName="accent-placeholder"
              onChangeText={(next) => {
                setText(next);
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
            />
            <ComposerActionButton
              accessibilityLabel="Send"
              icon="arrow.up"
              variant="primary"
              disabled={!canSend}
              onPress={() => void send()}
            />
          </View>
        </ComposerSurface>
        {sending && attachments.length > 0 ? (
          <Text className="pt-1.5 text-center text-xs text-foreground-muted">Uploading…</Text>
        ) : null}
      </View>
    </View>
  );
}
