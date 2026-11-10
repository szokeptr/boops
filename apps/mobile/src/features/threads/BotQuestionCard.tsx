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
  /** The bot's colour, which a picked option wears. */
  readonly accent: BotAccent;
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
  const nextDisabled = disabled || resolvePendingUserInputAnswer(question, draft) === null;
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
      <View className={cn(QUESTION_CARD_CLASS_NAME, "gap-1 border-foreground/14 px-2 pb-2 pt-1")}>
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
            <Text className="pr-2 pt-0.5 font-sans text-xs text-foreground-muted">
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
                accent={props.accent}
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
            disabled={nextDisabled}
            onPress={() => finishOrAdvance(props.drafts)}
            className={cn(
              "mr-1 min-h-[44px] min-w-16 items-center justify-center self-end rounded-full px-5 active:opacity-70",
              nextDisabled && "bg-subtle-strong",
            )}
            style={nextDisabled ? undefined : { backgroundColor: props.accent.background }}
          >
            <Text
              className={cn("font-t3-medium text-sm", nextDisabled && "text-foreground-muted")}
              style={nextDisabled ? undefined : { color: props.accent.foreground }}
            >
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

interface BotAccent {
  readonly background: string;
  readonly foreground: string;
}

// A hairline sets the card apart from the bot's bubbles; an answered card's fades with it.
const QUESTION_CARD_CLASS_NAME = "w-[85%] self-start rounded-[22px] border bg-user-bubble";

function OptionRow(props: {
  readonly letter: string;
  readonly selected: boolean;
  readonly checkbox: boolean;
  readonly disabled: boolean;
  readonly accent: BotAccent;
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
        "min-h-[44px] w-full flex-row items-start gap-3 rounded-xl px-2 py-2",
        props.selected ? "bg-subtle-strong" : "active:bg-subtle",
      )}
    >
      <LetterBadge letter={props.letter} accent={props.selected ? props.accent : null}>
        {props.checkbox && props.selected ? (
          <SymbolView name="checkmark" size={11} tintColor={props.accent.foreground} />
        ) : null}
      </LetterBadge>
      <View className="min-w-0 flex-1 gap-0.5 pt-0.5">{props.children}</View>
    </Pressable>
  );
}

function LetterBadge(props: {
  readonly letter: string;
  readonly accent: BotAccent | null;
  /** An answered pick steps back so it never outshouts the bot's reply. */
  readonly muted?: boolean;
  readonly children?: ReactNode;
}) {
  return (
    <View
      className={cn(
        "size-6.5 items-center justify-center rounded-lg",
        props.accent ? null : "border border-foreground/30 bg-foreground/10",
      )}
      style={
        props.accent
          ? { backgroundColor: props.accent.background, opacity: props.muted ? 0.6 : 1 }
          : undefined
      }
    >
      {props.children ?? (
        <Text
          className={cn("font-t3-bold text-xs", props.accent ? null : "text-foreground")}
          style={props.accent ? { color: props.accent.foreground } : undefined}
        >
          {props.letter}
        </Text>
      )}
    </View>
  );
}

/** An answered question settles into a quiet card: what was asked and what you picked. */
export function BotAnsweredQuestionCard(props: {
  readonly answers: ReadonlyArray<{
    readonly id: string;
    readonly question: string;
    readonly answer: string;
  }>;
  readonly accent: BotAccent;
}) {
  return (
    <View
      accessible
      accessibilityLabel={props.answers
        .map(({ question, answer }) => `${question} ${answer}`.trim())
        .join(". ")}
      className={cn(QUESTION_CARD_CLASS_NAME, "mb-5 gap-3 border-foreground/10 px-4 py-3.5")}
    >
      {props.answers.map(({ id, question, answer }) => (
        <View key={id} className="gap-2.5">
          {question ? (
            <Text className="font-sans text-base leading-snug text-foreground-muted">
              {question}
            </Text>
          ) : null}
          {answer ? (
            <View className="flex-row items-center gap-3">
              <LetterBadge letter="" accent={props.accent} muted>
                <SymbolView name="checkmark" size={11} tintColor={props.accent.foreground} />
              </LetterBadge>
              <Text className="min-w-0 flex-1 font-sans text-base text-foreground-muted">
                {answer}
              </Text>
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}
