import { useState } from "react";
import { Modal, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import type { ConnectorKeyPrompt } from "./useConnectorSignIn";

const INPUT_CLASS = "min-h-11 rounded-xl border-continuous bg-card px-3 text-base text-foreground";

/** Asks for an API key; it lives only in this sheet's state and the request. */
export function ConnectorKeySheet(props: {
  readonly prompt: ConnectorKeyPrompt;
  readonly busy: boolean;
  readonly onSubmit: (apiKey: string, headerName?: string) => Promise<string | null>;
  readonly onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [apiKey, setApiKey] = useState("");
  const [headerName, setHeaderName] = useState("Authorization");
  const [error, setError] = useState<string | null>(null);
  const { prompt } = props;
  const name = prompt.kind === "new" ? prompt.choice.name : prompt.connection.displayName;
  const entry = prompt.kind === "new" ? prompt.choice.entry : null;
  const hint = entry?.auth.kind === "api-key" ? entry.auth.hint : null;
  const asksHeader = prompt.kind === "new" && "url" in prompt.choice.target;
  const ready = apiKey.trim().length > 0 && !props.busy;

  const submit = async () => {
    if (!ready) return;
    const header = headerName.trim();
    setError(await props.onSubmit(apiKey.trim(), asksHeader && header ? header : undefined));
  };

  return (
    <Modal
      animationType="slide"
      presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"}
      onRequestClose={() => {
        if (!props.busy) props.onClose();
      }}
    >
      <ScrollView
        className="flex-1 bg-sheet-solid"
        contentContainerClassName="gap-5 p-5"
        contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="gap-1">
          <Text className="font-t3-bold text-lg text-foreground">
            {prompt.kind === "new" ? `Connect ${name}` : `Sign in to ${name} again`}
          </Text>
          <Text className="font-sans text-sm leading-5 text-foreground-muted">
            The key stays on the server. Bots use {name} through it and never see the key.
          </Text>
        </View>
        <View className="gap-2">
          <Text className="font-t3-medium text-sm text-foreground">API key</Text>
          <TextInput
            accessibilityLabel="API key"
            className={INPUT_CLASS}
            value={apiKey}
            onChangeText={setApiKey}
            editable={!props.busy}
            secureTextEntry
            autoCorrect={false}
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            onSubmitEditing={() => void submit()}
          />
          {hint ? <Text className="font-sans text-xs text-foreground-muted">{hint}</Text> : null}
          {entry ? (
            <Button
              label="Open the docs"
              tone="text"
              onPress={() => void tryOpenExternalUrl(entry.docsUrl, "provider-auth")}
            />
          ) : null}
        </View>
        {asksHeader ? (
          <View className="gap-2">
            <Text className="font-t3-medium text-sm text-foreground">Header</Text>
            <TextInput
              accessibilityLabel="Header"
              className={INPUT_CLASS}
              value={headerName}
              onChangeText={setHeaderName}
              editable={!props.busy}
              autoCorrect={false}
              autoCapitalize="none"
              spellCheck={false}
            />
            <Text className="font-sans text-xs text-foreground-muted">
              Authorization keys are sent as Bearer tokens.
            </Text>
          </View>
        ) : null}
        {error !== null ? (
          <Text accessibilityRole="alert" className="font-sans text-sm text-danger-foreground">
            {error}
          </Text>
        ) : null}
        <Button
          label={props.busy ? "Connecting…" : "Connect"}
          tone="primary"
          disabled={!ready}
          onPress={() => void submit()}
          fullWidth
        />
        <Button
          label="Cancel"
          tone="secondary"
          disabled={props.busy}
          onPress={props.onClose}
          fullWidth
        />
      </ScrollView>
    </Modal>
  );
}
