import {
  buildPendingUserInputAnswers,
  type PendingUserInputDraftAnswer,
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOptionSelection,
} from "@t3tools/client-runtime/state/pending-user-input";
import {
  seedUserInputDraftAnswers,
  type ThreadPendingUserInput,
} from "@t3tools/client-runtime/state/thread-requests";
import {
  type EnvironmentId,
  type ProviderApprovalDecision,
  type ProviderApprovalOption,
  ROOM_APPROVAL_DECISIONS,
  type RoomId,
  type RoomPendingRequest,
} from "@t3tools/contracts";
import { useState } from "react";

import { roomEnvironment, useRoomFeed } from "../../state/rooms";
import { useAtomCommand } from "../../state/use-atom-command";
import { BotAvatar } from "../bots/BotAvatar";
import { BotQuestionCard } from "../chat/BotQuestionCard";
import { ComposerPendingApprovalActions } from "../chat/ComposerPendingApprovalActions";
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

const FALLBACK_APPROVAL_OPTIONS = [
  { decision: "cancel", label: "Cancel" },
  { decision: "decline", label: "Decline" },
  { decision: "accept", label: "Approve" },
] satisfies ReadonlyArray<ProviderApprovalOption>;

function roomApprovalOptions(request: RoomPendingRequest): ReadonlyArray<ProviderApprovalOption> {
  const offered = (request.options ?? []).filter((option) =>
    ROOM_APPROVAL_DECISIONS.has(option.decision),
  );
  return offered.length > 0 ? offered : FALLBACK_APPROVAL_OPTIONS;
}

const ignore = () => {};

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

/** A room's question in the shape the thread's question card reads. */
function questionPrompt(request: RoomPendingRequest): ThreadPendingUserInput {
  return {
    requestId: request.requestId,
    createdAt: request.createdAt,
    questions: request.questions.map((question) => ({
      ...question,
      multiSelect: question.multiSelect === true,
    })),
    responseCapability: "live",
    dismissible: false,
  };
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
  const [drafts, setDrafts] = useState<Record<string, PendingUserInputDraftAnswer>>({});
  const [questionIndex, setQuestionIndex] = useState(0);
  const send = async (input: {
    readonly decision?: ProviderApprovalDecision;
    readonly answers?: Readonly<Record<string, unknown>>;
  }) => {
    setBusy(true);
    const result = await respond({
      environmentId: props.environmentId,
      input: {
        roomId: props.roomId,
        projectId: request.projectId,
        requestId: request.requestId,
        ...input,
      },
    });
    setBusy(false);
    return result;
  };
  const title =
    request.kind === "question"
      ? "has a question"
      : (APPROVAL_TITLES[request.requestKind] ?? "needs your go-ahead");
  const header = (
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
  );

  if (request.kind === "question") {
    const prompt = questionPrompt(request);
    const questionById = new Map(prompt.questions.map((question) => [question.id, question]));
    // Suggested answers show until edited, as in a thread.
    const seeded = seedUserInputDraftAnswers(prompt.questions, drafts);
    const advance = () => {
      if (questionIndex < prompt.questions.length - 1) {
        setQuestionIndex(questionIndex + 1);
        return;
      }
      const answers = buildPendingUserInputAnswers(prompt.questions, seeded);
      if (answers !== null) void send({ answers });
    };
    return (
      <section aria-label={`${request.botName} ${title}`} className="flex flex-col gap-1.5">
        <div className="px-1">{header}</div>
        <BotQuestionCard
          prompt={prompt}
          cwd={undefined}
          threadRef={undefined}
          disabled={!request.canAnswer}
          isResponding={busy}
          answers={seeded}
          questionIndex={questionIndex}
          onToggleOption={(questionId, optionValue) => {
            const question = questionById.get(questionId);
            if (question === undefined) return;
            setDrafts((current) => ({
              ...current,
              [questionId]: togglePendingUserInputOptionSelection(
                question,
                current[questionId],
                optionValue,
              ),
            }));
          }}
          onChangeCustomAnswer={(questionId, value) => {
            const question = questionById.get(questionId);
            if (question === undefined) return;
            setDrafts((current) => ({
              ...current,
              [questionId]: setPendingUserInputCustomAnswer(question, current[questionId], value),
            }));
          }}
          onAdvance={advance}
          onDismiss={ignore}
        />
      </section>
    );
  }

  return (
    <section
      aria-label={`${request.botName} ${title}`}
      className="rounded-2xl border border-border/70 bg-card px-4 py-3 shadow-composer dark:shadow-none"
    >
      {header}
      {request.prompt ? (
        <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 font-mono text-xs [overflow-wrap:anywhere]">
          {request.prompt}
        </pre>
      ) : null}
      {request.canAnswer ? (
        <footer className="mt-3 flex justify-end gap-2">
          <ComposerPendingApprovalActions
            requestId={request.requestId}
            isResponding={busy}
            canRespond
            options={roomApprovalOptions(request)}
            onRespondToApproval={(_requestId, decision) => send({ decision })}
          />
        </footer>
      ) : null}
    </section>
  );
}
