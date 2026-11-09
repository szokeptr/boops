import {
  buildPendingUserInputAnswers,
  isPendingUserInputOptionSelected,
  type PendingUserInputDraftAnswer,
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOptionSelection,
} from "@t3tools/client-runtime/state/pending-user-input";
import type {
  ProviderApprovalDecision,
  ProviderUserInputAnswers,
  RoomPendingRequest,
} from "@t3tools/contracts";
import { useState } from "react";
import { TextInput, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { BotAvatarSlot } from "../bots/BotAvatarSlot";
import type { RoomBot } from "./roomPresentation";

const REQUEST_KIND_TITLES: Readonly<Record<string, string>> = {
  command: "Run a command",
  "file-change": "Change files",
  "file-read": "Read a file",
  permission: "App permission",
};

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
  const [drafts, setDrafts] = useState<Record<string, PendingUserInputDraftAnswer>>({});
  const answers = buildPendingUserInputAnswers(request.questions, drafts);
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
              numberOfLines={6}
              className="font-mono text-sm leading-normal text-foreground-secondary"
            >
              {request.prompt}
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
                <View className="flex-row flex-wrap gap-2">
                  {question.options.map((option) => {
                    const value = option.value ?? option.label;
                    const selected = isPendingUserInputOptionSelected(question, draft, value);
                    return (
                      <Button
                        key={value}
                        label={option.label}
                        tone={selected ? "primary" : "secondary"}
                        disabled={disabled}
                        onPress={() =>
                          setDraft(
                            question.id,
                            togglePendingUserInputOptionSelection(question, draft, value),
                          )
                        }
                      />
                    );
                  })}
                </View>
              ) : null}
              {question.allowCustomAnswer === false ? null : (
                <TextInput
                  accessibilityLabel={`Answer: ${question.question}`}
                  editable={!disabled}
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
            <Button
              label="Approve"
              tone="primary"
              disabled={disabled}
              onPress={() => void respond({ decision: "accept" })}
            />
            <Button
              label="Decline"
              tone="danger"
              disabled={disabled}
              onPress={() => void respond({ decision: "decline" })}
            />
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
