import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

// Bot reply previews are sealed per phone; the relay and APNs only carry ciphertext. Envelope
// (unpadded base64url): 0x01 || ephemeralPub(32) || nonce(12) || AES-256-GCM ciphertext+tag. Key:
// HKDF-SHA256(X25519(eph, device), salt = ephemeralPub || devicePub, info below). AAD is
// `${environmentId}/${threadId}`; plaintext is JSON `{"text"}`. Opened by the iOS service extension.
export const NOTIFICATION_PREVIEW_ENVELOPE_VERSION = 1;
export const NOTIFICATION_PREVIEW_HKDF_INFO = "boops-notification-preview-v1";
export const NOTIFICATION_PREVIEW_MAX_TEXT_LENGTH = 200;

/** X25519 public key, raw 32 bytes as unpadded base64url. */
export const NotificationDevicePublicKey = TrimmedNonEmptyString.check(
  Schema.isPattern(/^[A-Za-z0-9_-]{43}$/),
);
export type NotificationDevicePublicKey = typeof NotificationDevicePublicKey.Type;

/** The relay's mobile device id, so the relay can hand each phone its own ciphertext. */
export const NotificationDeviceId = TrimmedNonEmptyString.check(Schema.isMaxLength(128));
export type NotificationDeviceId = typeof NotificationDeviceId.Type;

export const NotificationsRegisterDeviceKeyInput = Schema.Struct({
  deviceId: NotificationDeviceId,
  publicKey: NotificationDevicePublicKey,
});
export type NotificationsRegisterDeviceKeyInput = typeof NotificationsRegisterDeviceKeyInput.Type;

export const NotificationsRemoveDeviceKeyInput = Schema.Struct({
  deviceId: NotificationDeviceId,
});
export type NotificationsRemoveDeviceKeyInput = typeof NotificationsRemoveDeviceKeyInput.Type;

export class NotificationKeysError extends Schema.TaggedError<NotificationKeysError>()(
  "NotificationKeysError",
  {
    reason: Schema.Literals(["persistence", "limit-reached"]),
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.reason === "limit-reached"
      ? "Too many devices are registered for notifications."
      : "Could not save the device's notification key.";
  }
}
