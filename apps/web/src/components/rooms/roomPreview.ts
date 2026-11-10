import { botMessagePreview } from "@t3tools/client-runtime/state/bot-list";
import { type RoomMessage, roomParticipantKey } from "@t3tools/contracts";

/** A room's last message as one line: "Anna: …", "You: …", or a note such as "Anna left." as is. */
export function roomMessagePreview(message: RoomMessage, myKey: string | null): string {
  const text =
    botMessagePreview(message.text) ?? (message.attachments.length > 0 ? "Sent an attachment" : "");
  if (message.author.kind === "system") return text;
  const name = roomParticipantKey(message.author) === myKey ? "You" : message.authorName;
  return `${name}: ${text}`;
}
