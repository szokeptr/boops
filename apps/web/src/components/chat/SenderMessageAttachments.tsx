import type { AssetResource, EnvironmentId } from "@t3tools/contracts";

import { useAssetUrls } from "../../assets/assetUrls";
import type { ChatAttachment } from "../../types";
import { GuestMessageAttachments } from "./GuestMessageAttachments";

const openInNewTab = (url: string) => window.open(url, "_blank", "noopener,noreferrer");

/**
 * Files on a message from someone else in a shared timeline, such as a group chat: images
 * inline, files as rows that open in a new tab. Both load through asset URLs.
 */
export function SenderMessageAttachments(props: {
  readonly environmentId: EnvironmentId;
  readonly attachments: ReadonlyArray<ChatAttachment>;
}) {
  const resources: ReadonlyArray<AssetResource> = props.attachments.map((attachment) => ({
    _tag: "attachment",
    attachmentId: attachment.id,
    fileName: attachment.name,
    mimeType: attachment.mimeType,
  }));
  const urls = useAssetUrls(props.environmentId, resources);
  const urlById = new Map(
    props.attachments.flatMap((attachment, index) => {
      const url = urls[index];
      return url ? [[attachment.id, url] as const] : [];
    }),
  );
  const open = (attachment: ChatAttachment) => {
    const url = urlById.get(attachment.id);
    if (url) openInNewTab(url);
  };
  return (
    <GuestMessageAttachments
      attachments={props.attachments}
      imageUrl={(attachment) => urlById.get(attachment.id)}
      onOpenImage={open}
      onOpenFile={open}
    />
  );
}
