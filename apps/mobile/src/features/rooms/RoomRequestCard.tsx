import {
  buildPendingUserInputAnswers,
  isPendingUserInputOptionSelected,
  type PendingUserInputDraftAnswer,
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOptionSelection,
} from "@t3tools/client-runtime/state/pending-user-input";
import { seedUserInputDraftAnswers } from "@t3tools/client-runtime/state/thread-requests";
import type {
  ProviderApprovalDecision,
  ProviderUserInputAnswers,
  RoomPendingRequest,
} from "@t3tools/contracts";
import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { cn } from "../../lib/cn";
import { BotAvatarSlot } from "../bots/BotAvatarSlot";
import { type RoomBot, roomApprovalOptions } from "./roomPresentation";

const REQUEST_KIND_TITLES: Readonly<Record<string, string>> = {
  command: "Run a command",
  "file-change": "Change files",
  "file-read": "Read a file",
  permission: "App permission",
  "mcp-elicitation": "Fill in details for a Connection",
  dynamic_tool_call: "Use a tool",
  auth_refresh: "Sign in again",
};

const PROMPT_LINES = 6;

export type RoomRequestAnswer =
  | { readonly decision: ProviderApprovalDecision }
  | { readonly answers: ProviderUserInputAnswers };

/**
 * A bot waiting on someone in the room, drawn like a conversation's approval card. Only the
 * person whose message started the turn, or the owner, can answer; everyone else sees who.
 */
export function RoomRequestCard(props: {
  readonly request: RoomPendingRequest;
  readonly bot: RoomBot | undefined;
  readonly onRespond: (answer: RoomRequestAnswer) => Promise<boolean>;
}) {
  const { request } = props;
  const [responding, setResponding] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, PendingUserInputDraftAnswer>>(() =>
    seedUserInputDraftAnswers(request.questions, {}),
  );
  const [promptExpanded, setPromptExpanded] = useState(false);
  const promptClips =
    request.prompt !== null &&
    (request.prompt.split("\n").length > PROMPT_LINES || request.prompt.length > 240);
  const answers = buildPendingUserInputAnswers(request.questions, drafts);
  const approvalOptions = roomApprovalOptions(request.options);
  const warning = approvalOptions.find((option) => option.warning)?.warning;
  const respond = async (answer: RoomRequestAnswer) => {
    setResponding(true);
    const done = await props.onRespond(answer);
    // A sent answer leaves with the request; a failed one stays to try again.
    if (!done) setResponding(false);
  };
  const disabled = !request.canAnswer || responding;
  const setDraft = (questionId: string, draft: PendingUserInputDraftAnswer) =>
    setDrafts((current) => ({ ...current, [questionId]: draft }));

  return (
    <View className="gap-2.5 rounded-[20px] border border-border bg-card-alt p-4">
      <View className="flex-row items-center gap-1.5">
        <BotAvatarSlot
          avatar={props.bot?.avatar ?? null}
          name={request.botName}
          status="needs-you"
          size={18}
        />
        <Text className="font-t3-bold text-2xs uppercase tracking-[1.1px] text-foreground-secondary">
          {request.kind === "approval" ? `${request.botName} asks to` : `${request.botName} asks`}
        </Text>
      </View>
      {request.kind === "approval" ? (
        <>
          <Text className="font-t3-bold text-lg text-foreground">
            {REQUEST_KIND_TITLES[request.requestKind] ?? "Approval needed"}
          </Text>
          {request.prompt ? (
            <Text
              selectable
              numberOfLines={promptExpanded ? undefined : PROMPT_LINES}
              className="font-mono text-sm leading-normal text-foreground-secondary"
            >
              {request.prompt}
            </Text>
          ) : null}
          {promptClips ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: promptExpanded }}
              hitSlop={8}
              className="self-start active:opacity-60"
              onPress={() => setPromptExpanded((open) => !open)}
            >
              <Text className="font-t3-bold text-xs text-foreground-secondary underline">
                {promptExpanded ? "Show less" : "Show all"}
              </Text>
            </Pressable>
          ) : null}
          {warning ? (
            <Text className="font-sans text-xs leading-normal text-warning-foreground">
              {warning}
            </Text>
          ) : null}
        </>
      ) : (
        request.questions.map((question) => {
          const draft = drafts[question.id];
          return (
            <View key={question.id} className="gap-2">
              <Text className="font-t3-bold text-base text-foreground">{question.question}</Text>
              {question.options.length > 0 ? (
                <View className="gap-2">
                  {question.options.map((option) => {
                    const value = option.value ?? option.label;
                    const selected = isPendingUserInputOptionSelected(question, draft, value);
                    const description =
                      option.description !== option.label ? option.description : undefined;
                    return (
                      <Pressable
                        key={value}
                        accessibilityRole={question.multiSelect ? "checkbox" : "radio"}
                        accessibilityState={{ checked: selected, disabled }}
                        disabled={disabled}
                        className={cn(
                          "min-h-12 w-full gap-0.5 rounded-2xl border px-3.5 py-3",
                          selected ? "border-primary bg-primary/10" : "border-border bg-input",
                        )}
                        onPress={() =>
                          setDraft(
                            question.id,
                            togglePendingUserInputOptionSelection(question, draft, value),
                          )
                        }
                      >
                        <Text
                          className={cn(
                            "font-t3-bold text-sm",
                            selected ? "text-foreground" : "text-foreground-secondary",
                          )}
                        >
                          {option.label}
                        </Text>
                        {description ? (
                          <Text className="font-sans text-sm leading-5 text-foreground-muted">
                            {description}
                          </Text>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
              {question.allowCustomAnswer === false ? null : (
                <TextInput
                  accessibilityLabel={`Answer: ${question.question}`}
                  editable={!disabled}
                  multiline={question.initialAnswer !== undefined}
                  placeholder={question.options.length > 0 ? "Or write an answer" : "Your answer"}
                  placeholderTextColorClassName="accent-placeholder"
                  className="rounded-xl border border-border px-3 py-2 font-sans text-base text-foreground"
                  value={draft?.customAnswer ?? ""}
                  onChangeText={(text) =>
                    setDraft(question.id, setPendingUserInputCustomAnswer(question, draft, text))
                  }
                />
              )}
            </View>
          );
        })
      )}
      {request.canAnswer ? (
        request.kind === "approval" ? (
          <View className="flex-row flex-wrap gap-2.5">
            {approvalOptions.map((option) => (
              <Button
                key={option.decision}
                label={option.label}
                tone={
                  option.decision === "accept"
                    ? "primary"
                    : option.decision === "decline"
                      ? "danger"
                      : "secondary"
                }
                disabled={disabled}
                onPress={() => void respond({ decision: option.decision })}
              />
            ))}
          </View>
        ) : (
          <Button
            label="Send answer"
            tone={answers === null ? "secondary" : "primary"}
            disabled={disabled || answers === null}
            onPress={() => {
              if (answers !== null) void respond({ answers });
            }}
          />
        )
      ) : (
        <Text className="font-sans text-sm text-foreground-muted">
          Waiting on {request.askedForName}
        </Text>
      )}
    </View>
  );
}
