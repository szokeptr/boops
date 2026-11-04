import { botAvatarSeed, botMonogram } from "@t3tools/client-runtime/state/bot-list";
import type { ProjectId } from "@t3tools/contracts";

import { cn } from "~/lib/utils";
import { PROJECT_ICON_COLORS } from "../../projectIconColors";

// Gray reads as disabled next to the other placeholders.
const PLACEHOLDER_COLORS = PROJECT_ICON_COLORS.filter((color) => color.value !== "gray");

export function BotAvatar(props: {
  readonly projectId: ProjectId;
  readonly name: string;
  readonly avatar: string | null;
  readonly className?: string | undefined;
}) {
  if (props.avatar !== null) {
    return (
      <img
        src={props.avatar}
        alt=""
        aria-hidden="true"
        className={cn("size-9 shrink-0 rounded-full object-cover", props.className)}
      />
    );
  }
  const color = PLACEHOLDER_COLORS[botAvatarSeed(props.projectId) % PLACEHOLDER_COLORS.length];
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-full font-mono text-xs font-bold select-none",
        color?.className,
        props.className,
      )}
      style={{ backgroundColor: "color-mix(in srgb, currentColor 16%, transparent)" }}
    >
      {botMonogram(props.name)}
    </span>
  );
}
