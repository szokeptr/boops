import { shouldPreserveAssistantLineBreaks } from "@t3tools/shared/markdownPipeline";
import { CalendarClockIcon, ChevronDownIcon } from "lucide-react";
import { use, useState } from "react";

import { cn } from "~/lib/utils";
import { formatDayAwareTimestamp } from "../../timestampFormat";
import ChatMarkdown from "../ChatMarkdown";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { MESSAGE_HEADING_LEVEL, MessageAuthorHeading } from "./TimelineRowParts";
import { TimelineRowCtx, type TimelineRow } from "./timelineRowContext";

/** Earlier runs of a routine, folded to one faded line above its newest run. */
export function RoutineRunsTimelineRow({
  row,
}: {
  row: Extract<TimelineRow, { kind: "routine-runs" }>;
}) {
  const ctx = use(TimelineRowCtx);
  const [expanded, setExpanded] = useState(() =>
    ctx.workGroupViewState.expandedEntries.has(row.id),
  );
  const toggle = (open: boolean) => {
    ctx.onToggleWorkEntry(row.id, expanded);
    if (open) ctx.workGroupViewState.expandedEntries.add(row.id);
    else ctx.workGroupViewState.expandedEntries.delete(row.id);
    setExpanded(open);
  };
  const count = row.runs.length;

  return (
    <Collapsible
      open={expanded}
      onOpenChange={toggle}
      className="mx-auto flex w-full max-w-(--chat-content-max-width) flex-col items-center"
    >
      <MessageAuthorHeading>Routine</MessageAuthorHeading>
      <CollapsibleTrigger className="flex max-w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-muted-foreground/70 text-xs transition-colors hover:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">
        <CalendarClockIcon aria-hidden className="size-3 shrink-0" />
        <span className="truncate">{row.routine.name}</span>
        <span aria-hidden>·</span>
        <span className="shrink-0 tabular-nums">
          {count === 1 ? "1 earlier run" : `${count} earlier runs`}
        </span>
        <ChevronDownIcon
          aria-hidden
          className={cn("size-3 shrink-0 transition-transform", expanded && "rotate-180")}
        />
      </CollapsibleTrigger>
      <CollapsiblePanel className="w-full">
        <ol className="mt-2 flex flex-col gap-3 rounded-2xl border border-border/70 p-3">
          {row.runs.map((run) => (
            <li key={run.wake.id} className="flex min-w-0 flex-col gap-1">
              <span className="text-muted-foreground text-xs tabular-nums">
                {formatDayAwareTimestamp(run.wake.createdAt, ctx.timestampFormat)}
              </span>
              {run.replies.map((reply) => (
                <ChatMarkdown
                  key={reply.id}
                  text={reply.text}
                  cwd={ctx.markdownCwd}
                  threadRef={ctx.threadRef ?? undefined}
                  isStreaming={false}
                  lineBreaks={shouldPreserveAssistantLineBreaks(reply.text)}
                  skills={ctx.skills}
                  headingLevelOffset={MESSAGE_HEADING_LEVEL}
                  onUseArtifactTemplate={ctx.onUseArtifactTemplate}
                  onRunShellCommand={ctx.onRunShellCommand}
                  onImageExpand={ctx.onImageExpand}
                />
              ))}
            </li>
          ))}
        </ol>
      </CollapsiblePanel>
    </Collapsible>
  );
}
