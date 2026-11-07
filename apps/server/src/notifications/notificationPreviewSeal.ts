// @effect-diagnostics nodeBuiltinImport:off - X25519, HKDF and AES-GCM have no Effect equivalent.
import * as NodeCrypto from "node:crypto";

import {
  NOTIFICATION_PREVIEW_ENVELOPE_VERSION,
  NOTIFICATION_PREVIEW_HKDF_INFO,
  NOTIFICATION_PREVIEW_MAX_TEXT_LENGTH,
} from "@t3tools/contracts";

const X25519_KEY_LENGTH = 32;
const NONCE_LENGTH = 12;

const publicKeyObject = (raw: Uint8Array) =>
  NodeCrypto.createPublicKey({
    key: { kty: "OKP", crv: "X25519", x: Buffer.from(raw).toString("base64url") },
    format: "jwk",
  });

const rawPublicKey = (key: NodeCrypto.KeyObject): Buffer => {
  const { x } = key.export({ format: "jwk" });
  if (x === undefined) throw new Error("X25519 key has no public component");
  return Buffer.from(x, "base64url");
};

/** Lock-screen text: markdown markers dropped, whitespace collapsed, at most the preview length. */
export function notificationPreviewText(text: string): string {
  const plain = text
    .replace(/```[^\n]*\n?/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s+)?)/gm, "")
    .replace(/(\*\*|__|~~|`)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const codePoints = Array.from(plain);
  return codePoints.length <= NOTIFICATION_PREVIEW_MAX_TEXT_LENGTH
    ? plain
    : `${codePoints
        .slice(0, NOTIFICATION_PREVIEW_MAX_TEXT_LENGTH - 1)
        .join("")
        .trimEnd()}…`;
}

export interface SealNotificationPreviewInput {
  /** The phone's X25519 public key, raw 32 bytes as unpadded base64url. */
  readonly devicePublicKey: string;
  readonly environmentId: string;
  readonly threadId: string;
  readonly text: string;
  /** Fixed only by test vectors; production draws a fresh key and nonce per seal. */
  readonly ephemeralPrivateKey?: NodeCrypto.KeyObject;
  readonly nonce?: Uint8Array;
}

/** The envelope described in contracts' `notificationKeys.ts`, as unpadded base64url. */
export function sealNotificationPreview(input: SealNotificationPreviewInput): string {
  const deviceRaw = Buffer.from(input.devicePublicKey, "base64url");
  if (deviceRaw.length !== X25519_KEY_LENGTH) throw new Error("Invalid X25519 device key");
  const devicePublicKey = publicKeyObject(deviceRaw);
  const ephemeralPrivateKey =
    input.ephemeralPrivateKey ?? NodeCrypto.generateKeyPairSync("x25519").privateKey;
  const ephemeralRaw = rawPublicKey(NodeCrypto.createPublicKey(ephemeralPrivateKey));
  const nonce = Buffer.from(input.nonce ?? NodeCrypto.randomBytes(NONCE_LENGTH));
  if (nonce.length !== NONCE_LENGTH) throw new Error("Invalid AES-GCM nonce");

  const shared = NodeCrypto.diffieHellman({
    privateKey: ephemeralPrivateKey,
    publicKey: devicePublicKey,
  });
  const key = Buffer.from(
    NodeCrypto.hkdfSync(
      "sha256",
      shared,
      Buffer.concat([ephemeralRaw, deviceRaw]),
      NOTIFICATION_PREVIEW_HKDF_INFO,
      32,
    ),
  );
  const cipher = NodeCrypto.createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(`${input.environmentId}/${input.threadId}`, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify({ text: notificationPreviewText(input.text) }), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([
    Buffer.of(NOTIFICATION_PREVIEW_ENVELOPE_VERSION),
    ephemeralRaw,
    nonce,
    ciphertext,
    cipher.getAuthTag(),
  ]).toString("base64url");
}
