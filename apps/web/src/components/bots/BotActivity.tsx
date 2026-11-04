import {
  deriveBotActivity,
  resolveBotMainThreadId,
  type BotThreadRow,
} from "@t3tools/client-runtime/state/bot-list";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { isElectron } from "../../env";
import { workspaceAreaProps } from "../../lib/workspaceFocus";
import { useProject, useQuietThreadShells } from "../../state/entities";
import { useUiStateStore } from "../../uiStateStore";
import { RelativeTime } from "../RelativeTime";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { SidebarInset } from "../ui/sidebar";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { BotStatusLabel } from "./BotStatusLabel";

export function BotActivityPage(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}) {
  const project = useProject({ environmentId: props.environmentId, projectId: props.projectId });
  const threads = useQuietThreadShells();
  const localLastVisitedAt = useUiStateStore((state) => state.threadLastVisitedAtById);
  const contentArea = workspaceAreaProps("home", 1, "Activity");
  return (
    <SidebarInset
      {...contentArea}
      role="main"
      className="h-dvh min-h-0 overflow-hidden overscroll-y-none"
    >
      {project === null ? (
        <>
          <WorkspacePageHeader electron={isElectron} />
          <Empty className="flex-1">
            <EmptyHeader>
              <EmptyTitle>Bot not found</EmptyTitle>
              <EmptyDescription>
                It may have been removed, or its machine is offline.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </>
      ) : (
        <BotActivityView
          project={project}
          threads={threads}
          localLastVisitedAt={localLastVisitedAt}
        />
      )}
    </SidebarInset>
  );
}

export function BotActivityView(props: {
  readonly project: EnvironmentProject;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly localLastVisitedAt?: Readonly<Record<string, string>>;
}) {
  const { project } = props;
  const mainThreadId = resolveBotMainThreadId(project, props.threads);
  const rows = deriveBotActivity({
    project,
    threads: props.threads,
    ...(props.localLastVisitedAt ? { localLastVisitedAt: props.localLastVisitedAt } : {}),
  });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <WorkspacePageHeader electron={isElectron}>
        {mainThreadId === null ? null : (
          <Link
            to="/$environmentId/$threadId"
            params={{ environmentId: project.environmentId, threadId: mainThreadId }}
            aria-label={`Back to ${project.title}`}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeftIcon aria-hidden className="size-4" />
          </Link>
        )}
        <h1 className="min-w-0 truncate text-sm font-medium">
          {project.title}
          <span className="text-muted-foreground"> · Activity</span>
        </h1>
      </WorkspacePageHeader>
      {rows.length === 0 ? (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyTitle>No activity yet</EmptyTitle>
            <EmptyDescription>
              Routine runs and other work this bot does outside its conversation show up here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul
          aria-label={`${project.title} activity`}
          className="mx-auto flex w-full max-w-3xl min-h-0 flex-1 flex-col gap-px overflow-y-auto px-3 py-2"
        >
          {rows.map((row) => (
            <BotActivityRow key={row.threadId} row={row} />
          ))}
        </ul>
      )}
    </div>
  );
}

function BotActivityRow(props: { readonly row: BotThreadRow }) {
  const { row } = props;
  return (
    <li className="list-none">
      <Link
        to="/$environmentId/$threadId"
        params={{ environmentId: row.environmentId, threadId: row.threadId }}
        className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm outline-hidden hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span
          className={cn("min-w-0 flex-1 truncate", row.unread ? "font-semibold" : "font-medium")}
        >
          {row.title}
        </span>
        <BotStatusLabel status={row.status} className="text-xs" />
        {row.unread ? (
          <span
            aria-label="Unread"
            role="img"
            className="size-2 shrink-0 rounded-full bg-primary"
          />
        ) : null}
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          <RelativeTime timestamp={row.lastActivityAt} />
        </span>
      </Link>
    </li>
  );
}
