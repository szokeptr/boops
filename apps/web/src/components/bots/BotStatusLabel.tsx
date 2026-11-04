import type { BotStatus } from "@t3tools/client-runtime/state/bot-list";

import { cn } from "~/lib/utils";

const STATUS_PRESENTATION = {
  "needs-you": {
    label: "Needs you",
    className: "text-amber-600 dark:text-amber-300/90",
    dotClassName: "bg-amber-500 dark:bg-amber-300/90",
  },
  working: {
    label: "Working",
    className: "text-sky-600 dark:text-sky-300/80",
    dotClassName: "bg-sky-500 dark:bg-sky-300/80",
  },
} as const;

/** Nothing for idle; callers show the last message instead. */
export function BotStatusLabel(props: {
  readonly status: BotStatus;
  readonly className?: string | undefined;
}) {
  if (props.status === "idle") return null;
  const presentation = STATUS_PRESENTATION[props.status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 font-medium",
        presentation.className,
        props.className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", presentation.dotClassName)} />
      {presentation.label}
    </span>
  );
}
