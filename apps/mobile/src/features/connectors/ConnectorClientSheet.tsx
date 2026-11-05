import { connectorClientGuide } from "@t3tools/client-runtime/connectors";
import type { ConnectorOAuthClientInput } from "@t3tools/contracts";
import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { Modal, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import type { ConnectorClientPrompt } from "./useConnectorSignIn";

const INPUT_CLASS = "min-h-11 rounded-xl border-continuous bg-card px-3 text-base text-foreground";

/**
 * Asks for an OAuth client the user created with the provider, for a server without client
 * registration. Shows the catalog's steps and the redirect URI and scopes to register.
 */
export function ConnectorClientSheet(props: {
  readonly prompt: ConnectorClientPrompt;
  readonly busy: boolean;
  readonly onSubmit: (client: ConnectorOAuthClientInput) => Promise<string | null>;
  readonly onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { prompt } = props;
  const { setup, scopes } = connectorClientGuide(prompt.entry);
  // Catalog providers with a setup guide (Google) issue confidential clients only.
  const needsSecret = setup !== null;
  const ready =
    clientId.trim().length > 0 && (!needsSecret || clientSecret.trim().length > 0) && !props.busy;

  const submit = async () => {
    if (!ready) return;
    const secret = clientSecret.trim();
    setError(
      await props.onSubmit({
        clientId: clientId.trim(),
        ...(secret.length === 0 ? {} : { clientSecret: secret }),
      }),
    );
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
            {prompt.kind === "new" ? `Connect ${prompt.name}` : `Sign in to ${prompt.name} again`}
          </Text>
          <Text className="font-sans text-sm leading-5 text-foreground-muted">
            {prompt.name} needs an OAuth client you create. Its secret stays on the server.
          </Text>
        </View>
        {setup !== null ? (
          <View className="gap-2">
            {setup.steps.map((step, index) => (
              <Text key={step} className="font-sans text-sm leading-5 text-foreground-muted">
                {index + 1}. {step}
              </Text>
            ))}
            <Button
              label="Open the setup guide"
              tone="text"
              onPress={() => void tryOpenExternalUrl(setup.docsUrl, "provider-auth")}
            />
          </View>
        ) : null}
        <CopyRow label="Redirect URI" value={prompt.redirectUri} />
        {scopes.length > 0 ? <CopyRow label="Scopes" value={scopes.join(",")} /> : null}
        <View className="gap-2">
          <Text className="font-t3-medium text-sm text-foreground">Client ID</Text>
          <TextInput
            accessibilityLabel="Client ID"
            className={INPUT_CLASS}
            value={clientId}
            onChangeText={setClientId}
            editable={!props.busy}
            autoCorrect={false}
            autoCapitalize="none"
            spellCheck={false}
          />
        </View>
        <View className="gap-2">
          <Text className="font-t3-medium text-sm text-foreground">
            {needsSecret ? "Client secret" : "Client secret (if it has one)"}
          </Text>
          <TextInput
            accessibilityLabel="Client secret"
            className={INPUT_CLASS}
            value={clientSecret}
            onChangeText={setClientSecret}
            editable={!props.busy}
            secureTextEntry
            autoCorrect={false}
            autoCapitalize="none"
            spellCheck={false}
            onSubmitEditing={() => void submit()}
          />
        </View>
        {error !== null ? (
          <Text accessibilityRole="alert" className="font-sans text-sm text-danger-foreground">
            {error}
          </Text>
        ) : null}
        <Button
          label={props.busy ? "Opening…" : "Continue to sign in"}
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

function CopyRow(props: { readonly label: string; readonly value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <View className="gap-2">
      <Text className="font-t3-medium text-sm text-foreground">{props.label}</Text>
      <Text selectable className="font-mono text-xs leading-5 text-foreground-muted">
        {props.value}
      </Text>
      <Button
        label={copied ? "Copied" : `Copy ${props.label.toLowerCase()}`}
        tone="secondary"
        onPress={() =>
          void Clipboard.setStringAsync(props.value).then(
            () => setCopied(true),
            () => undefined,
          )
        }
      />
    </View>
  );
}
