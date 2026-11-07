import { ASSISTANT_CITATION_MAX_COMMENT_LENGTH, type AssistantCitation } from "@t3tools/contracts";
import { useState } from "react";
import { Platform, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "./ui/AppText";
import { Button } from "./ui/Button";
import { Sheet } from "./ui/Sheet";

/** Closing by any route keeps the typed comment, as dismissing the desktop popover does. */
export function ComposerCitationSheet(props: {
  readonly citation: AssistantCitation;
  readonly onSave: (comment: string) => void;
  readonly onRemove?: () => void;
  readonly onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [comment, setComment] = useState(props.citation.comment ?? "");
  const close = () => {
    if (comment.trim() !== (props.citation.comment ?? "").trim()) props.onSave(comment);
    props.onClose();
  };
  return (
    <Sheet title="Citation" onClose={close}>
      <ScrollView
        className="flex-1"
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior={Platform.OS === "ios" ? "automatic" : "never"}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 12,
          gap: 16,
          paddingBottom: Math.max(20, insets.bottom),
        }}
      >
        <View className="border-l-2 border-border pl-3">
          <Text className="text-foreground-muted" numberOfLines={12}>
            {props.citation.text}
          </Text>
        </View>
        <TextInput
          accessibilityLabel="Comment on this citation"
          value={comment}
          onChangeText={setComment}
          autoFocus
          multiline
          maxLength={ASSISTANT_CITATION_MAX_COMMENT_LENGTH}
          textAlignVertical="top"
          placeholder="Add a comment (optional)"
          placeholderTextColorClassName="accent-foreground-muted"
          className="max-h-40 min-h-24 rounded-2xl border border-input-border bg-input px-3.5 py-3 font-sans text-base text-foreground"
        />
        <Button label="Done" tone="primary" onPress={close} fullWidth />
        {props.onRemove ? (
          <Button label="Remove from draft" tone="secondary" onPress={props.onRemove} fullWidth />
        ) : null}
      </ScrollView>
    </Sheet>
  );
}
