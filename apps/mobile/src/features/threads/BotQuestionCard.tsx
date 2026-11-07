import {
  buildPendingUserInputAnswers,
  isPendingUserInputOptionSelected,
  resolvePendingUserInputAnswer,
  togglePendingUserInputOptionSelection,
  type PendingUserInputAnswer,
  type PendingUserInputDraftAnswer,
} from "@t3tools/client-runtime/state/pending-user-input";
import type { ThreadUserInputQuestion } from "@t3tools/client-runtime/state/thread-requests";
import type { EnvironmentId, RuntimeRequestId } from "@t3tools/contracts";
import { markdownProseDirection } from "@t3tools/shared/textDirection";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";
import type { PendingUserInput } from "../../lib/threadActivity";
import { proseDirectionStyle, QuestionText } from "./PendingUserInputCard";

/**
 * A bot's question as a card at the end of its chat, one question at a time. A single-choice
 * pick moves on, and the last one sends; the composer answers the shown question in words.
 */
export function BotQuestionCard(props: {
  readonly environmentId: EnvironmentId;
  readonly canOperateThread: boolean;
  readonly pendingUserInput: PendingUserInput;
  readonly questionIndex: number;
  readonly drafts: Record<string, PendingUserInputDraftAnswer>;
  readonly respondingUserInputId: RuntimeRequestId | null;
  readonly onSelectOption: (
    requestId: RuntimeRequestId,
    question: ThreadUserInputQuestion,
    value: string,
  ) => void;
  readonly onAdvance: () => void;
  readonly onSubmit: (answers?: Record<string, PendingUserInputAnswer>) => Promise<unknown>;
  readonly onDismiss: () => Promise<unknown>;
}) {
  const { pendingUserInput, questionIndex } = props;
  const questions = pendingUserInput.questions;
  const question = questions[questionIndex];
  if (!question) return null;
  const isLast = questionIndex >= questions.length - 1;
  const isResponding = props.respondingUserInputId === pendingUserInput.requestId;
  const disabled =
    !props.canOperateThread ||
    isResponding ||
    pendingUserInput.responseCapability === "not_resumable";
  const draft = props.drafts[question.id];
  const setDirection = markdownProseDirection(
    [question.question, ...question.options.map((option) => option.label)].join(" "),
  );
  const finishOrAdvance = (drafts: Record<string, PendingUserInputDraftAnswer>) => {
    if (!isLast) {
      props.onAdvance();
      return;
    }
    const answers = buildPendingUserInputAnswers(questions, drafts);
    if (answers) void props.onSubmit(answers);
  };
  const selectOption = (value: string) => {
    props.onSelectOption(pendingUserInput.requestId, question, value);
    if (question.multiSelect) return;
    finishOrAdvance({
      ...props.drafts,
      [question.id]: togglePendingUserInputOptionSelection(question, draft, value),
    });
  };

  return (
    <View className="gap-2">
      <View className="w-[85%] gap-1 self-start rounded-[20px] bg-user-bubble px-2 pb-2 pt-1">
        <View className="flex-row items-start gap-2 pl-2 pt-2.5">
          <View className="min-w-0 flex-1">
            <QuestionText
              markdown={question.question}
              environmentId={props.environmentId}
              setDirection={setDirection}
              bold
            />
          </View>
          {questions.length > 1 ? (
            <Text className="pt-0.5 font-sans text-xs text-foreground-muted">
              {questionIndex + 1} of {questions.length}
            </Text>
          ) : null}
          {pendingUserInput.dismissible ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Skip question"
              hitSlop={10}
              disabled={isResponding}
              onPress={() => void props.onDismiss()}
              className="h-6 w-6 items-center justify-center active:opacity-60"
            >
              <SymbolView
                name="xmark"
                size={13}
                tintColorClassName="accent-foreground-muted"
                type="monochrome"
              />
            </Pressable>
          ) : null}
        </View>
        <View className="pt-1">
          {question.options.map((option, index) => {
            const optionValue = option.value ?? option.label.trim();
            const selected = isPendingUserInputOptionSelected(question, draft, optionValue);
            const description =
              option.description !== option.label ? option.description : undefined;
            return (
              <OptionRow
                key={optionValue}
                letter={optionLetter(index)}
                selected={selected}
                checkbox={question.multiSelect === true}
                disabled={disabled}
                onPress={() => selectOption(optionValue)}
              >
                <Text
                  className="font-sans text-base text-foreground"
                  style={proseDirectionStyle(option.label, setDirection)}
                >
                  {option.label}
                </Text>
                {description ? (
                  <Text
                    className="font-sans text-sm leading-5 text-foreground-muted"
                    style={proseDirectionStyle(description, setDirection)}
                  >
                    {description}
                  </Text>
                ) : null}
              </OptionRow>
            );
          })}
        </View>
        {question.multiSelect ? (
          <Pressable
            accessibilityRole="button"
            disabled={disabled || resolvePendingUserInputAnswer(question, draft) === null}
            onPress={() => finishOrAdvance(props.drafts)}
            className="mr-1 self-end rounded-full bg-primary px-4 py-1.5 active:opacity-70 disabled:opacity-40"
          >
            <Text className="font-t3-medium text-sm text-primary-foreground">
              {isLast ? "Send" : "Next"}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {question.allowCustomAnswer === false ? null : (
        <Text className="px-3 font-sans text-sm text-foreground-muted">
          Or answer in the chat below
        </Text>
      )}
    </View>
  );
}

function optionLetter(index: number) {
  return index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
}

function OptionRow(props: {
  readonly letter: string;
  readonly selected: boolean;
  readonly checkbox: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole={props.checkbox ? "checkbox" : "button"}
      accessibilityState={{ checked: props.selected, disabled: props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      className={cn(
        "w-full flex-row items-center gap-3 rounded-xl px-2 py-2",
        props.selected ? "bg-subtle-strong" : "active:bg-subtle",
      )}
    >
      <View
        className={cn(
          "h-6 w-6 items-center justify-center rounded-md border",
          props.selected ? "border-primary bg-primary" : "border-border bg-subtle",
        )}
      >
        {props.checkbox && props.selected ? (
          <SymbolView name="checkmark" size={11} tintColorClassName="accent-primary-foreground" />
        ) : (
          <Text
            className={cn(
              "font-t3-medium text-2xs",
              props.selected ? "text-primary-foreground" : "text-foreground-muted",
            )}
          >
            {props.letter}
          </Text>
        )}
      </View>
      <View className="min-w-0 flex-1 gap-0.5">{props.children}</View>
    </Pressable>
  );
}
