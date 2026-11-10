import type { PendingUserInputDraftAnswer } from "@t3tools/client-runtime/state/pending-user-input";
import { type RuntimeRequestId, type ScopedThreadRef } from "@t3tools/contracts";
import { CheckIcon } from "lucide-react";
import { memo, useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { markdownProseDirection, textDirection } from "~/textDirection";
import { type PendingUserInput } from "../../session-logic";
import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";
import { usePendingQuestionAnswering } from "./usePendingQuestionAnswering";

const NO_SHORTCUT = () => null;

/**
 * A bot's question as a card in its chat, which hides the composer while it is open. A
 * single-select pick sends; "Something else" opens a field for the custom answer.
 */
export const BotQuestionCard = memo(function BotQuestionCard({
  prompt,
  cwd,
  threadRef,
  disabled,
  isResponding,
  answers,
  questionIndex,
  onToggleOption,
  onAdvance,
  onDismiss,
  onChangeCustomAnswer,
}: {
  prompt: PendingUserInput;
  cwd: string | undefined;
  /** Undefined outside a thread, such as in a group chat. */
  threadRef: ScopedThreadRef | undefined;
  disabled: boolean;
  isResponding: boolean;
  answers: Record<string, PendingUserInputDraftAnswer>;
  questionIndex: number;
  onToggleOption: (questionId: string, optionValue: string) => void;
  onAdvance: () => void;
  onDismiss: (requestId: RuntimeRequestId) => void;
  onChangeCustomAnswer: (questionId: string, value: string) => void;
}) {
  const { progress, activeQuestion, responseDisabled, selectOption, isOptionSelected } =
    usePendingQuestionAnswering({
      prompt,
      disabled,
      isResponding,
      answers,
      questionIndex,
      onToggleOption,
      onAdvance,
      // Letters would pick, and send, whatever a user starts typing before focusing the composer.
      shortcutsEnabled: false,
      shortcutIndex: NO_SHORTCUT,
    });
  const [customOpenQuestionId, setCustomOpenQuestionId] = useState<string | null>(null);
  if (!activeQuestion) return null;

  const direction = markdownProseDirection(
    [activeQuestion.question, ...activeQuestion.options.map((option) => option.label)].join(" "),
  );
  const questionCount = prompt.questions.length;
  const customAnswerActive = progress.customAnswer.trim().length > 0;
  const customOpen = customAnswerActive || customOpenQuestionId === activeQuestion.id;
  const showsSend = activeQuestion.multiSelect || customOpen;
  const showsFooter = showsSend || prompt.dismissible;

  return (
    <div className="chat-content-lane" data-bot-question-card="true">
      <div
        dir={direction}
        role="group"
        aria-label={activeQuestion.header || "Question"}
        className="w-full max-w-5/6 rounded-3xl border bg-card p-1.5 text-card-foreground shadow-xs/5 sm:w-fit sm:min-w-sm"
      >
        <div className="flex items-start gap-3 px-3 pt-2.5 pb-1.5">
          <ChatMarkdown
            text={activeQuestion.question}
            cwd={cwd}
            threadRef={threadRef}
            className="min-w-0 flex-1 font-semibold text-foreground"
          />
          {questionCount > 1 ? (
            <span className="mt-0.5 shrink-0 text-muted-foreground text-xs tabular-nums">
              {progress.questionIndex + 1} of {questionCount}
            </span>
          ) : null}
        </div>
        <div className="flex flex-col gap-0.5">
          {activeQuestion.options.map((option, index) => {
            const optionValue = option.value ?? option.label;
            const selected = isOptionSelected(index, optionValue);
            return (
              <QuestionOptionRow
                key={`${activeQuestion.id}:${optionValue}`}
                badge={
                  activeQuestion.multiSelect && selected ? (
                    <CheckIcon className="size-3.5" />
                  ) : (
                    optionBadge(index)
                  )
                }
                selected={selected}
                disabled={responseDisabled}
                pressed={selected}
                onClick={() => selectOption(activeQuestion.id, optionValue)}
              >
                <span className="text-sm" dir={textDirection(option.label)}>
                  {option.label}
                </span>
                {option.description && option.description !== option.label ? (
                  <span
                    className="text-muted-foreground text-xs"
                    dir={textDirection(option.description)}
                  >
                    {option.description}
                  </span>
                ) : null}
              </QuestionOptionRow>
            );
          })}
          {activeQuestion.allowCustomAnswer === false ? null : customOpen ? (
            <div className="flex w-full items-start gap-3 rounded-2xl bg-accent px-2.5 py-2">
              <span
                aria-hidden
                className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-primary bg-primary font-medium text-primary-foreground text-xs"
              >
                {optionBadge(activeQuestion.options.length)}
              </span>
              <textarea
                autoFocus
                rows={1}
                aria-label="Your answer"
                placeholder="Type your answer"
                value={progress.customAnswer}
                disabled={responseDisabled}
                dir={textDirection(progress.customAnswer)}
                onChange={(event) => onChangeCustomAnswer(activeQuestion.id, event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && !customAnswerActive) {
                    event.preventDefault();
                    setCustomOpenQuestionId(null);
                    return;
                  }
                  if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
                    return;
                  }
                  event.preventDefault();
                  if (progress.canAdvance) onAdvance();
                }}
                className="field-sizing-content mt-0.5 max-h-40 min-h-5 min-w-0 flex-1 resize-none bg-transparent text-sm leading-5 outline-none placeholder:text-muted-foreground"
              />
            </div>
          ) : (
            <QuestionOptionRow
              badge={optionBadge(activeQuestion.options.length)}
              selected={false}
              disabled={responseDisabled}
              onClick={() => setCustomOpenQuestionId(activeQuestion.id)}
            >
              <span className="text-muted-foreground text-sm">Something else</span>
            </QuestionOptionRow>
          )}
        </div>
        {showsFooter ? (
          <div className="flex items-center justify-end gap-1 px-1.5 pt-1.5 pb-0.5">
            {prompt.dismissible ? (
              <Button
                variant="ghost"
                size="compact"
                disabled={isResponding}
                onClick={() => onDismiss(prompt.requestId)}
              >
                Skip
              </Button>
            ) : null}
            {showsSend ? (
              <Button
                size="compact"
                disabled={responseDisabled || !progress.canAdvance}
                onClick={onAdvance}
              >
                {progress.isLastQuestion ? "Send" : "Next"}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
});

function optionBadge(index: number) {
  return index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
}

function QuestionOptionRow({
  badge,
  selected,
  disabled,
  pressed,
  onClick,
  children,
}: {
  badge: ReactNode;
  selected: boolean;
  disabled: boolean;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-2xl px-2.5 py-2 text-start outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60",
        selected ? "bg-accent" : "enabled:hover:bg-accent/60",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-lg border font-medium text-xs transition-colors duration-150",
          selected
            ? "border-primary bg-primary text-primary-foreground"
            : "bg-background text-muted-foreground",
        )}
      >
        {badge}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">{children}</span>
    </button>
  );
}
