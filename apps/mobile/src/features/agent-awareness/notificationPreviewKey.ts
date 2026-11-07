import { x25519 } from "@noble/curves/ed25519";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Result from "effect/Result";
import Constants from "expo-constants";
import * as ExpoCrypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/**
 * The Notification Service Extension reads this exact keychain item to open sealed bot reply
 * previews (plugins/notification-service/NotificationService.swift). expo-secure-store stores it
 * as service `${SERVICE}:no-auth`, account = UTF-8 of the key name, value = UTF-8 base64url text.
 */
const NOTIFICATION_PREVIEW_KEY_NAME = "notification-preview-private-key";
const NOTIFICATION_PREVIEW_KEY_SERVICE = "boops.notification-keys";

interface NotificationPreviewKeyPair {
  /** Raw 32-byte X25519 private key, unpadded base64url. */
  readonly privateKey: string;
  /** Raw 32-byte X25519 public key, unpadded base64url (43 chars). */
  readonly publicKey: string;
}

export function notificationPreviewKeyPairFromPrivateKey(
  privateKey: Uint8Array,
): NotificationPreviewKeyPair {
  if (privateKey.length !== 32) {
    throw new Error("A notification preview private key is 32 bytes.");
  }
  return {
    privateKey: Base64Url.encode(privateKey),
    publicKey: Base64Url.encode(x25519.getPublicKey(privateKey)),
  };
}

export function decodeStoredNotificationPreviewKey(
  stored: string,
): NotificationPreviewKeyPair | null {
  const decoded = Result.getOrUndefined(Base64Url.decode(stored));
  if (decoded?.length !== 32) return null;
  return notificationPreviewKeyPairFromPrivateKey(decoded);
}

/** The keychain group the extension shares; null where no extension ships (Android, Personal Teams). */
export function notificationPreviewKeyAccessGroup(): string | null {
  if (Platform.OS !== "ios") return null;
  const group: unknown = Constants.expoConfig?.extra?.notificationService?.keychainAccessGroup;
  return typeof group === "string" && group.length > 0 ? group : null;
}

function storeOptions(accessGroup: string): SecureStore.SecureStoreOptions {
  return {
    keychainService: NOTIFICATION_PREVIEW_KEY_SERVICE,
    accessGroup,
    // The extension decrypts on the lock screen.
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  };
}

let cached: NotificationPreviewKeyPair | null = null;

/** This phone's preview key, created on first use when `create` is set. */
export async function loadNotificationPreviewKeyPair(options: {
  readonly create: boolean;
}): Promise<NotificationPreviewKeyPair | null> {
  if (cached) return cached;
  const accessGroup = notificationPreviewKeyAccessGroup();
  if (!accessGroup) return null;
  const stored = await SecureStore.getItemAsync(
    NOTIFICATION_PREVIEW_KEY_NAME,
    storeOptions(accessGroup),
  );
  const restored = stored === null ? null : decodeStoredNotificationPreviewKey(stored);
  if (restored) {
    cached = restored;
    return restored;
  }
  if (!options.create) return null;
  const generated = notificationPreviewKeyPairFromPrivateKey(ExpoCrypto.getRandomBytes(32));
  await SecureStore.setItemAsync(
    NOTIFICATION_PREVIEW_KEY_NAME,
    generated.privateKey,
    storeOptions(accessGroup),
  );
  cached = generated;
  return generated;
}
