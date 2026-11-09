import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { runAttachmentUploadCycle } from "@t3tools/client-runtime/state/attachments";
import {
  type ChatAttachment,
  ChatAttachmentId,
  type EnvironmentId,
  PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPES,
} from "@t3tools/contracts";

import { uploadBytes } from "../../lib/attachmentUploadQueue";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { attachmentEnvironment } from "../../state/attachments";
import { readPreparedConnection } from "../../state/session";

const IMAGE_TYPES: ReadonlySet<string> = new Set(PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPES);

/**
 * Uploads one file for a group chat message and returns it as the room's post expects: a pending
 * attachment the room claims when the message is sent.
 */
export async function uploadRoomFile(input: {
  readonly environmentId: EnvironmentId;
  readonly file: File;
  readonly onProgress: (progress: number) => void;
}): Promise<ChatAttachment> {
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
    onMinted: () => "continue",
    onTransferStart: () => {},
  });
  if (result.status !== "uploaded") throw new Error(`Could not upload ${input.file.name}.`);
  const base = {
    id: ChatAttachmentId.make(result.attachmentId),
    name: input.file.name,
    sizeBytes: input.file.size,
  };
  return image
    ? ({ ...base, type: "image", mimeType } as ChatAttachment)
    : ({ ...base, type: "file", mimeType } as ChatAttachment);
}
