import { connectorMonogram } from "@t3tools/client-runtime/connectors";
import { Image } from "expo-image";
import { useState } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";

/** The service's own icon, or its initial when there is none or it fails to load. */
export function ConnectorIcon(props: {
  readonly name: string;
  readonly iconUrl: string | null | undefined;
  readonly size?: number;
}) {
  const size = props.size ?? 32;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = props.iconUrl ?? null;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="items-center justify-center overflow-hidden rounded-lg border border-border bg-card"
      style={{ width: size, height: size }}
    >
      {url === null || failedUrl === url ? (
        <Text className="font-t3-bold text-sm text-foreground-muted">
          {connectorMonogram(props.name)}
        </Text>
      ) : (
        <Image
          source={{ uri: url }}
          cachePolicy="memory-disk"
          contentFit="contain"
          style={{ width: size * 0.6, height: size * 0.6 }}
          onError={() => setFailedUrl(url)}
          accessibilityIgnoresInvertColors
        />
      )}
    </View>
  );
}
