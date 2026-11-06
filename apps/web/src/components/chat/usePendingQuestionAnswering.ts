import type { PendingUserInputDraftAnswer } from "@t3tools/client-runtime/state/pending-user-input";
import { use, useEffect, useEffectEvent, useRef, useState } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { isInSideChatPane } from "~/lib/sideChatPane";
import { derivePendingUserInputProgress } from "../../pendingUserInput";
import { type PendingUserInput } from "../../session-logic";
import { BackgroundThreadContext } from "./backgroundThread";

/**
 * Option picking shared by the composer's question banner and a bot chat's question card: a
 * single-select pick shows at once and advances shortly after, and `shortcutIndex` maps a key
 * press to an option while focus is outside any text field.
 */
export function usePendingQuestionAnswering({
  prompt,
  disabled,
  isResponding,
  answers,
  questionIndex,
  onToggleOption,
  onAdvance,
  shortcutsEnabled,
  shortcutIndex,
}: {
  prompt: PendingUserInput;
  disabled: boolean;
  isResponding: boolean;
  answers: Record<string, PendingUserInputDraftAnswer>;
  questionIndex: number;
  onToggleOption: (questionId: string, optionValue: string) => void;
  onAdvance: () => void;
  shortcutsEnabled: boolean;
  shortcutIndex: (key: string) => number | null;
}) {
  // Message-mode requests remain answerable after their provider turn ends.
  const canRespond = prompt.responseCapability !== "not_resumable";
  const responseDisabled = disabled || isResponding || !canRespond;
  const autoAdvanceTimerRef = useRef<number | null>(null);
  const advance = useStableCallback(onAdvance);
  const [optimisticSingleSelect, setOptimisticSingleSelect] = useState<{
    questionId: string;
    optionValue: string;
  } | null>(null);
  const progress = derivePendingUserInputProgress(prompt.questions, answers, questionIndex);
  const activeQuestion = progress.activeQuestion;
  const customAnswerActive = progress.customAnswer.trim().length > 0;
  // Read before later hooks to preserve the question's compiler cache.
  const draftSelectedOptions = activeQuestion?.options.map(
    (option) =>
      !customAnswerActive && progress.selectedOptionValues.includes(option.value ?? option.label),
  );

  if (
    optimisticSingleSelect &&
    activeQuestion &&
    !activeQuestion.multiSelect &&
    (optimisticSingleSelect.questionId !== activeQuestion.id ||
      (!customAnswerActive &&
        progress.selectedOptionValues.includes(optimisticSingleSelect.optionValue)))
  ) {
    setOptimisticSingleSelect(null);
  }

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- clears the auto-advance timer when the question changes, input is disabled, or the panel unmounts
  useEffect(() => {
    const clearAutoAdvance = () => {
      if (autoAdvanceTimerRef.current !== null) {
        window.clearTimeout(autoAdvanceTimerRef.current);
        autoAdvanceTimerRef.current = null;
      }
    };
    if (disabled || activeQuestion?.id === undefined) clearAutoAdvance();
    return clearAutoAdvance;
  }, [activeQuestion?.id, disabled]);

  const selectOption = (questionId: string, optionValue: string) => {
    if (disabled || isResponding) return;
    if (activeQuestion?.multiSelect) {
      onToggleOption(questionId, optionValue);
      return;
    }
    setOptimisticSingleSelect({ questionId, optionValue });
    onToggleOption(questionId, optionValue);
    if (autoAdvanceTimerRef.current !== null) {
      window.clearTimeout(autoAdvanceTimerRef.current);
    }
    autoAdvanceTimerRef.current = window.setTimeout(() => {
      autoAdvanceTimerRef.current = null;
      advance();
    }, 200);
  };

  const selectOptionFromShortcut = useEffectEvent(selectOption);
  const optionIndexForKey = useEffectEvent(shortcutIndex);
  const backgroundThread = use(BackgroundThreadContext);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes a document keydown listener for option shortcuts while a question is answerable
  useEffect(() => {
    if (!activeQuestion || responseDisabled || !shortcutsEnabled || backgroundThread) return;
    const handler = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (isInSideChatPane(target)) return;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return;
      }
      if (
        target instanceof HTMLElement &&
        target.closest('[contenteditable]:not([contenteditable="false"])')
      ) {
        return;
      }
      const optionIndex = optionIndexForKey(event.key);
      if (optionIndex === null) return;
      const option = activeQuestion.options[optionIndex];
      if (!option) return;
      event.preventDefault();
      selectOptionFromShortcut(activeQuestion.id, option.value ?? option.label);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [activeQuestion, backgroundThread, responseDisabled, shortcutsEnabled]);

  const isOptionSelected = (index: number, optionValue: string) =>
    (optimisticSingleSelect?.questionId === activeQuestion?.id &&
      optimisticSingleSelect?.optionValue === optionValue) ||
    draftSelectedOptions?.[index] === true;

  return { progress, activeQuestion, responseDisabled, selectOption, isOptionSelected };
}
