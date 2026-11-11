import {
  MESSAGE_QUICK_REACTIONS,
  type OrchestrationV2MessageReaction,
  type OrchestrationV2MessageReactor,
} from "@t3tools/contracts";

export { MESSAGE_QUICK_REACTIONS };

/** What the reaction picker offers past the quick row; typing any emoji also works. */
export const MORE_REACTION_EMOJIS: ReadonlyArray<string> = [
  "😀",
  "😁",
  "😅",
  "🥹",
  "😊",
  "😍",
  "🥰",
  "😘",
  "😎",
  "🤩",
  "🥳",
  "😏",
  "🤔",
  "🫡",
  "🤯",
  "😬",
  "😢",
  "😭",
  "😤",
  "😡",
  "😱",
  "🙈",
  "🙏",
  "👏",
  "🙌",
  "💪",
  "👀",
  "🤝",
  "✌️",
  "👌",
  "🤞",
  "🫶",
  "🔥",
  "✨",
  "🎉",
  "💯",
  "✅",
  "❌",
  "⚡",
  "🚀",
  "💡",
  "🧠",
  "👑",
  "🏆",
  "🍕",
  "☕",
  "🌈",
  "💀",
];

// Hermes has no Intl.Segmenter, so one emoji is matched by shape: a flag, a keycap, or
// pictographs with their modifiers joined by ZWJ.
const PICTOGRAPH = String.raw`\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})*`;
const LEADING_EMOJI = new RegExp(
  String.raw`^(?:\p{Regional_Indicator}{2}|[#*0-9]️?⃣|${PICTOGRAPH}(?:‍${PICTOGRAPH})*)`,
  "u",
);

/** One emoji from typed text, or null when it does not start with one. */
export function firstEmoji(value: string): string | null {
  return LEADING_EMOJI.exec(value.trim())?.[0] ?? null;
}

export interface MessageReactionGroup {
  readonly emoji: string;
  readonly count: number;
  /** The user is one of the reactors, so choosing this emoji again removes theirs. */
  readonly mine: boolean;
  /** Who reacted, for a label: "You" first, then bots by name. */
  readonly names: ReadonlyArray<string>;
}

function reactorName(by: OrchestrationV2MessageReactor): string {
  return by.kind === "user" ? "You" : by.name;
}

/** Reactions grouped by emoji, in the order each emoji was first chosen. */
export function groupMessageReactions(
  reactions: ReadonlyArray<OrchestrationV2MessageReaction> | undefined,
): ReadonlyArray<MessageReactionGroup> {
  if (reactions === undefined || reactions.length === 0) return [];
  const groups = new Map<string, { mine: boolean; names: Array<string> }>();
  for (const reaction of [...reactions].sort((left, right) => left.at.localeCompare(right.at))) {
    const group = groups.get(reaction.emoji) ?? { mine: false, names: [] };
    if (reaction.by.kind === "user") {
      group.mine = true;
      group.names.unshift(reactorName(reaction.by));
    } else {
      group.names.push(reactorName(reaction.by));
    }
    groups.set(reaction.emoji, group);
  }
  return [...groups].map(([emoji, group]) => ({
    emoji,
    count: group.names.length,
    mine: group.mine,
    names: group.names,
  }));
}

export function myMessageReaction(
  reactions: ReadonlyArray<OrchestrationV2MessageReaction> | undefined,
): string | null {
  return reactions?.find((reaction) => reaction.by.kind === "user")?.emoji ?? null;
}

/** Choosing the emoji the user already reacted with takes it back, as a tapback does. */
export function toggledMessageReaction(current: string | null, chosen: string): string | null {
  return current === chosen ? null : chosen;
}

/** "You and Pixel reacted with ❤️": an accessible label for one badge. */
export function messageReactionLabel(group: MessageReactionGroup): string {
  const names =
    group.names.length <= 2
      ? group.names.join(" and ")
      : `${group.names.slice(0, -1).join(", ")} and ${group.names.at(-1)}`;
  return `${names} reacted with ${group.emoji}`;
}
