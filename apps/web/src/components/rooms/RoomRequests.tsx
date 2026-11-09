import type {
  EnvironmentId,
  ProviderApprovalDecision,
  RoomId,
  RoomPendingRequest,
} from "@t3tools/contracts";
import { useState } from "react";

import { roomEnvironment, useRoomFeed } from "../../state/rooms";
import { useAtomCommand } from "../../state/use-atom-command";
import { BotAvatar } from "../bots/BotAvatar";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { RoomBot } from "./RoomTimeline";

const APPROVAL_TITLES: Readonly<Record<string, string>> = {
  command: "wants to run a command",
  "file-read": "wants to read a file",
  "file-change": "wants to change files",
  permission: "asks for permission",
  "mcp-elicitation": "needs details from a Connection",
  dynamic_tool_call: "wants to use a tool",
  auth_refresh: "needs you to sign in again",
};

/**
 * What the room's bots are waiting on, docked above the composer: the person whose message
 * started the turn answers, as does the owner; everyone else sees who it is waiting on.
 */
export function RoomRequests(props: {
  readonly environmentId: EnvironmentId;
  readonly roomId: RoomId;
  readonly bots: ReadonlyArray<RoomBot>;
}) {
  const requests = useRoomFeed(props.environmentId, props.roomId).data?.requests ?? [];
  if (requests.length === 0) return null;
  return (
    <div className="mx-auto mb-2 flex w-full max-w-(--chat-content-max-width) flex-col gap-2">
      {requests.map((request) => (
        <RequestCard
          key={`${request.projectId}:${request.requestId}`}
          environmentId={props.environmentId}
          roomId={props.roomId}
          request={request}
          bot={props.bots.find((bot) => bot.projectId === request.projectId)}
        />
      ))}
    </div>
  );
}

function RequestCard(props: {
  readonly environmentId: EnvironmentId;
  readonly roomId: RoomId;
  readonly request: RoomPendingRequest;
  readonly bot: RoomBot | undefined;
}) {
  const { request } = props;
  const respond = useAtomCommand(roomEnvironment.respond, "Could not answer");
  const [busy, setBusy] = useState(false);
  const [answers, setAnswers] = useState<Readonly<Record<string, string>>>({});
  const send = async (input: {
    readonly decision?: ProviderApprovalDecision;
    readonly answers?: Readonly<Record<string, string>>;
  }) => {
    setBusy(true);
    await respond({
      environmentId: props.environmentId,
      input: {
        roomId: props.roomId,
        projectId: request.projectId,
        requestId: request.requestId,
        ...input,
      },
    });
    setBusy(false);
  };
  const title =
    request.kind === "question"
      ? "has a question"
      : (APPROVAL_TITLES[request.requestKind] ?? "needs your go-ahead");
  const allAnswered = request.questions.every((question) => answers[question.id] !== undefined);
  return (
    <section
      aria-label={`${request.botName} ${title}`}
      className="rounded-2xl border border-border/70 bg-card px-4 py-3 shadow-composer dark:shadow-none"
    >
      <header className="flex items-center gap-2">
        <BotAvatar
          avatar={props.bot?.avatar ?? null}
          name={request.botName}
          status="needs-you"
          size={20}
        />
        <p className="min-w-0 flex-1 truncate text-sm">
          <span className="font-medium">{request.botName}</span> {title}
        </p>
        {request.canAnswer ? null : (
          <span className="shrink-0 text-muted-foreground text-xs">
            Waiting on {request.askedForName}
          </span>
        )}
      </header>
      {request.prompt ? (
        <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 font-mono text-xs [overflow-wrap:anywhere]">
          {request.prompt}
        </pre>
      ) : null}
      {request.questions.map((question) => (
        <fieldset key={question.id} className="mt-2.5" disabled={!request.canAnswer || busy}>
          <legend className="mb-1.5 text-sm">{question.question}</legend>
          <div className="flex flex-wrap gap-1.5">
            {question.options.map((option) => {
              const value = option.value ?? option.label;
              const selected = answers[question.id] === value;
              return (
                <Tooltip key={option.label}>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        size="xs"
                        variant={selected ? "default" : "outline"}
                        aria-pressed={selected}
                        onClick={() => setAnswers({ ...answers, [question.id]: value })}
                      />
                    }
                  >
                    {option.label}
                  </TooltipTrigger>
                  <TooltipPopup side="top">{option.description}</TooltipPopup>
                </Tooltip>
              );
            })}
          </div>
        </fieldset>
      ))}
      {request.canAnswer ? (
        <footer className="mt-3 flex justify-end gap-2">
          {request.kind === "approval" ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void send({ decision: "decline" })}
              >
                Decline
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() => void send({ decision: "accept" })}
              >
                Allow
              </Button>
            </>
          ) : (
            <Button
              type="button"
              size="sm"
              disabled={busy || !allAnswered}
              onClick={() => void send({ answers })}
            >
              Answer
            </Button>
          )}
        </footer>
      ) : null}
    </section>
  );
}
