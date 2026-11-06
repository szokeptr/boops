import { type RuntimeRequestId, type ScopedThreadRef } from "@t3tools/contracts";
import { markdownProseDirection, textDirection } from "~/textDirection";
import { memo, useState } from "react";
import { type PendingUserInput } from "../../session-logic";
import type { PendingUserInputDraftAnswer } from "@t3tools/client-runtime/state/pending-user-input";
import { CheckboxMark } from "../ui/checkbox";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Kbd } from "../ui/kbd";
import { cn } from "~/lib/utils";
import { ComposerBanner } from "./ComposerBanner";
import ChatMarkdown from "../ChatMarkdown";
import { usePendingQuestionAnswering } from "./usePendingQuestionAnswering";

function digitShortcutIndex(key: string): number | null {
  const digit = Number.parseInt(key, 10);
  return Number.isNaN(digit) || digit < 1 || digit > 9 ? null : digit - 1;
}

interface PendingUserInputPanelProps {
  pendingUserInputs: PendingUserInput[];
  cwd: string | undefined;
  threadRef: ScopedThreadRef;
  disabled?: boolean;
  respondingRequestIds: RuntimeRequestId[];
  answers: Record<string, PendingUserInputDraftAnswer>;
  questionIndex: number;
  onToggleOption: (questionId: string, optionValue: string) => void;
  onAdvance: () => void;
  onDismiss: (requestId: RuntimeRequestId) => void;
}

export const ComposerPendingUserInputPanel = memo(function ComposerPendingUserInputPanel({
  pendingUserInputs,
  cwd,
  threadRef,
  disabled = false,
  respondingRequestIds,
  answers,
  questionIndex,
  onToggleOption,
  onAdvance,
  onDismiss,
}: PendingUserInputPanelProps) {
  if (pendingUserInputs.length === 0) return null;
  const activePrompt = pendingUserInputs[0];
  if (!activePrompt) return null;

  return (
    <ComposerPendingUserInputCard
      key={activePrompt.requestId}
      prompt={activePrompt}
      cwd={cwd}
      threadRef={threadRef}
      disabled={disabled}
      isResponding={respondingRequestIds.includes(activePrompt.requestId)}
      answers={answers}
      questionIndex={questionIndex}
      onToggleOption={onToggleOption}
      onAdvance={onAdvance}
      onDismiss={onDismiss}
    />
  );
});

const ComposerPendingUserInputCard = memo(function ComposerPendingUserInputCard({
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
}: {
  prompt: PendingUserInput;
  cwd: string | undefined;
  threadRef: ScopedThreadRef;
  disabled: boolean;
  isResponding: boolean;
  answers: Record<string, PendingUserInputDraftAnswer>;
  questionIndex: number;
  onToggleOption: (questionId: string, optionValue: string) => void;
  onAdvance: () => void;
  onDismiss: (requestId: RuntimeRequestId) => void;
}) {
  const [collapsedQuestionId, setCollapsedQuestionId] = useState<string | null>(null);
  const isCollapsed =
    collapsedQuestionId !== null &&
    collapsedQuestionId ===
      prompt.questions[Math.min(questionIndex, prompt.questions.length - 1)]?.id;
  const { activeQuestion, selectOption, isOptionSelected } = usePendingQuestionAnswering({
    prompt,
    disabled,
    isResponding,
    answers,
    questionIndex,
    onToggleOption,
    onAdvance,
    shortcutsEnabled: !isCollapsed,
    shortcutIndex: digitShortcutIndex,
  });

  if (!activeQuestion) {
    return null;
  }

  const promptDirection = markdownProseDirection(
    prompt.questions
      .flatMap((question) => [
        question.header,
        question.question,
        ...question.options.flatMap((option) => [option.label, option.description ?? ""]),
      ])
      .join(" "),
  );
  const questionTextAlign = promptDirection === "rtl" ? "text-right" : "text-left";

  return (
    <Collapsible
      dir={promptDirection}
      open={!isCollapsed}
      onOpenChange={(open) => {
        setCollapsedQuestionId(open ? null : activeQuestion.id);
      }}
    >
      <CollapsibleTrigger
        render={<ComposerBanner.Row render={<button type="button" />} />}
        title={
          isCollapsed ? "Show the question and its options" : "Hide the question and its options"
        }
        data-pending-user-input-toggle={isCollapsed ? "collapsed" : "expanded"}
        className="px-4 pt-1.5"
      >
        <ComposerBanner.Content>
          <span
            className={cn("min-w-0 truncate text-muted-foreground", isCollapsed && "max-w-1/2")}
            dir={textDirection(activeQuestion.header)}
          >
            {activeQuestion.header}
          </span>
          {isCollapsed ? (
            <>
              <ComposerBanner.Separator />
              <span
                className={cn("min-w-0 flex-1 truncate text-secondary-label", questionTextAlign)}
                dir={markdownProseDirection(activeQuestion.question)}
              >
                {activeQuestion.question}
              </span>
            </>
          ) : null}
        </ComposerBanner.Content>
        <ComposerBanner.Actions className="gap-0">
          {prompt.questions.length > 1 ? (
            <ComposerBanner.Count>
              {questionIndex + 1}/{prompt.questions.length}
            </ComposerBanner.Count>
          ) : null}
          <ComposerBanner.ToggleIcon expanded={!isCollapsed} />
          {prompt.dismissible ? (
            <ComposerBanner.Dismiss
              render={<span role="button" tabIndex={0} />}
              aria-label="Dismiss question without answering"
              title="Dismiss question without answering"
              disabled={isResponding}
              data-pending-user-input-dismiss
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onDismiss(prompt.requestId);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                event.stopPropagation();
                onDismiss(prompt.requestId);
              }}
            />
          ) : null}
        </ComposerBanner.Actions>
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <ComposerBanner.Scroll>
          <ComposerBanner.Body className="ps-6 pe-4 pb-1 wrap-anywhere sm:ps-5.5">
            <ChatMarkdown
              text={activeQuestion.question}
              cwd={cwd}
              threadRef={threadRef}
              className={cn("pt-2 text-foreground/85", questionTextAlign)}
            />
            {/* Rows span the header row's width so the radios align with the question text and the shortcut column sits under the dismiss button. */}
            <div className="-ms-2 mt-1.5 sm:-ms-1.5">
              {activeQuestion.options.map((option, index) => {
                const optionValue = option.value ?? option.label;
                const isSelected = isOptionSelected(index, optionValue);
                const className = cn(
                  questionTextAlign,
                  "group flex w-full items-start gap-2.5 rounded-md bg-transparent py-1.5 ps-2 sm:ps-1.5 outline-none transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/25",
                  isSelected ? "text-foreground" : "text-foreground/70 hover:bg-muted/30",
                  (disabled || isResponding) && "opacity-50 cursor-not-allowed",
                  !disabled && !isResponding && "cursor-pointer",
                );
                // The h-5 slots match the label's line box, so the indicator and shortcut stay on its first line.
                const content = (
                  <>
                    <span className="pointer-events-none flex h-5 shrink-0 items-center">
                      {activeQuestion.multiSelect ? (
                        <CheckboxMark checked={isSelected} />
                      ) : (
                        <OptionRadio checked={isSelected} />
                      )}
                    </span>
                    <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                      <span className="text-sm font-medium" dir={textDirection(option.label)}>
                        {option.label}
                      </span>
                      {option.description && option.description !== option.label ? (
                        <span
                          className="text-secondary-label text-2xs"
                          dir={textDirection(option.description)}
                        >
                          {option.description}
                        </span>
                      ) : null}
                    </div>
                    {index < 9 ? (
                      <span className="flex h-5 w-7 shrink-0 items-center justify-center sm:w-6">
                        <Kbd>{index + 1}</Kbd>
                      </span>
                    ) : null}
                  </>
                );
                return (
                  <button
                    key={`${activeQuestion.id}:${optionValue}`}
                    type="button"
                    aria-pressed={isSelected}
                    disabled={disabled || isResponding}
                    onClick={() => {
                      selectOption(activeQuestion.id, optionValue);
                    }}
                    className={className}
                  >
                    {content}
                  </button>
                );
              })}
            </div>
          </ComposerBanner.Body>
        </ComposerBanner.Scroll>
      </CollapsiblePanel>
    </Collapsible>
  );
});

// Drawn with ui/radio-group's look instead of using its Radio: Radio only checks inside a
// RadioGroup, whose arrow keys select options and would trip the single-select auto-advance.
function OptionRadio({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex size-4.5 shrink-0 items-center justify-center rounded-full border border-input bg-background not-dark:bg-clip-padding sm:size-4 dark:bg-input/32",
        checked ? "shadow-none" : "shadow-xs/5",
      )}
    >
      {checked ? (
        <span className="-inset-px absolute flex items-center justify-center rounded-full bg-primary before:size-2 before:rounded-full before:bg-primary-foreground sm:before:size-1.5" />
      ) : null}
    </span>
  );
}
