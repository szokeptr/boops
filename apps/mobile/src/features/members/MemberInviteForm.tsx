import type { EnvironmentMember } from "@t3tools/contracts";
import { useState } from "react";
import { View } from "react-native";

import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";

const INPUT_CLASS = "min-h-11 rounded-xl border-continuous bg-card px-3 text-base text-foreground";

export function memberStatusText(member: EnvironmentMember): string {
  return `${member.status === "active" ? "Active" : "Invited"} · ${member.email}`;
}

/** Name and email; the invite reaches that email's Boops Connect account. */
export function MemberInviteForm(props: {
  readonly submitLabel: string;
  readonly onSubmit: (input: {
    readonly label: string;
    readonly email: string;
  }) => Promise<string | null>;
  readonly onCancel?: () => void;
}) {
  const [label, setLabel] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = label.trim().length > 0 && email.trim().includes("@") && !busy;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    const failure = await props.onSubmit({ label: label.trim(), email: email.trim() });
    setBusy(false);
    setError(failure);
    if (failure === null) {
      setLabel("");
      setEmail("");
    }
  };

  return (
    <View className="gap-3">
      <View className="gap-2">
        <Text className="font-t3-medium text-sm text-foreground">Name</Text>
        <TextInput
          accessibilityLabel="Name"
          className={INPUT_CLASS}
          value={label}
          onChangeText={setLabel}
          editable={!busy}
          placeholder="Anna"
          autoCapitalize="words"
          autoFocus
          returnKeyType="next"
        />
      </View>
      <View className="gap-2">
        <Text className="font-t3-medium text-sm text-foreground">Email</Text>
        <TextInput
          accessibilityLabel="Email"
          className={INPUT_CLASS}
          value={email}
          onChangeText={setEmail}
          editable={!busy}
          placeholder="anna@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="send"
          onSubmitEditing={() => void submit()}
        />
        <Text className="font-sans text-xs text-foreground-muted">
          They accept in the Boops app, signed in to Boops Connect with this email.
        </Text>
      </View>
      {error !== null ? (
        <Text accessibilityRole="alert" className="font-sans text-sm text-danger-foreground">
          {error}
        </Text>
      ) : null}
      <View className="flex-row gap-3">
        {props.onCancel ? (
          <View className="flex-1">
            <Button
              label="Cancel"
              tone="secondary"
              disabled={busy}
              onPress={props.onCancel}
              fullWidth
            />
          </View>
        ) : null}
        <View className="flex-1">
          <Button
            label={props.submitLabel}
            tone="primary"
            disabled={!ready}
            loading={busy}
            onPress={() => void submit()}
            fullWidth
          />
        </View>
      </View>
    </View>
  );
}
