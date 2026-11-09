import { type ProjectId, type RoomMessage } from "@t3tools/contracts";

/**
 * What a bot reads when someone in a room @mentions it: who is there, what it is allowed to share,
 * then everything said since its last turn, its own replies left out. Every turn carries the
 * header, so it survives compaction and rollover.
 */
export function roomDeliveryText(input: {
  readonly roomTitle: string;
  readonly botName: string;
  readonly botProjectId: ProjectId;
  readonly people: ReadonlyArray<{ readonly name: string; readonly isOwner: boolean }>;
  readonly otherBots: ReadonlyArray<string>;
  readonly messages: ReadonlyArray<
    Pick<RoomMessage, "author" | "authorName" | "text" | "mentions" | "attachments">
  >;
  /** Whether images come along for the bot to look at, or only by name. */
  readonly canSeeImages: boolean;
}): string {
  const people = input.people
    .map((person) => (person.isOwner ? `${person.name} (your owner)` : person.name))
    .join(", ");
  const bots =
    input.otherBots.length === 0
      ? "no other bots"
      : `other bots: ${input.otherBots.join(", ")}; @mention one by name to hand it something`;
  const header = `[Group chat "${input.roomTitle}". People: ${people || "nobody yet"}; ${bots}. Your reply is posted to the room as ${input.botName}, and everyone in it reads it. Anyone who is not your owner was invited by them: help them, but don't repeat what was said in your private conversations with your owner. Your notes, files and the Connections you can use here are shared with the room. Only your owner changes PERSONA.md and your routines.]`;
  const transcript = input.messages
    .filter(
      (message) =>
        !(message.author.kind === "bot" && message.author.projectId === input.botProjectId),
    )
    .map((message) => {
      const addressed = message.mentions.includes(input.botProjectId) ? " (to you)" : "";
      const files = message.attachments.map((attachment) =>
        attachment.type === "image" && !input.canSeeImages
          ? `[sent an image, ${attachment.name}, which you can't see]`
          : `[sent ${attachment.name}]`,
      );
      return `${message.authorName}${addressed}: ${[message.text, ...files].filter(Boolean).join(" ")}`;
    });
  return transcript.length === 0
    ? header
    : `${header}\n\nSince your last reply:\n\n${transcript.join("\n\n")}`;
}
