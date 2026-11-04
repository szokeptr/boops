import { botMonogram, type BotStatus } from "@t3tools/client-runtime/state/bot-list";

import { cn } from "~/lib/utils";

export type BotAvatarSize = 16 | 32 | 48 | 64;

const SIZE_CLASS: Record<BotAvatarSize, string> = {
  16: "size-4 text-4xs",
  32: "size-8 text-2xs",
  48: "size-12 text-sm",
  64: "size-16 text-base",
};

/**
 * Where a bot's avatar renders. A monogram stands in until the pixel-art
 * avatar lands; that component takes the same props.
 */
export function BotAvatarSlot(props: {
  readonly avatar: string | null;
  readonly name: string;
  readonly status: BotStatus;
  readonly size: BotAvatarSize;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md bg-muted font-mono font-bold text-muted-foreground select-none",
        SIZE_CLASS[props.size],
      )}
    >
      {botMonogram(props.name)}
    </span>
  );
}
