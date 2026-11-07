// @effect-diagnostics nodeBuiltinImport:off - opens envelopes the way the phone does.
import * as NodeCrypto from "node:crypto";

import { NOTIFICATION_PREVIEW_HKDF_INFO } from "@t3tools/contracts";

const X25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");

export const x25519PrivateKeyFromRaw = (raw: Uint8Array) =>
  NodeCrypto.createPrivateKey({
    key: Buffer.concat([X25519_PKCS8_PREFIX, raw]),
    format: "der",
    type: "pkcs8",
  });

export const rawX25519PublicKey = (key: NodeCrypto.KeyObject): string => {
  const { x } = NodeCrypto.createPublicKey(key).export({ format: "jwk" });
  if (x === undefined) throw new Error("X25519 key has no public component");
  return x;
};

export function makeDeviceKey() {
  const { privateKey } = NodeCrypto.generateKeyPairSync("x25519");
  return { privateKey, publicKey: rawX25519PublicKey(privateKey) };
}

/** What the iOS Notification Service Extension does with a preview envelope. */
export function openNotificationPreview(input: {
  readonly envelope: string;
  readonly devicePrivateKey: NodeCrypto.KeyObject;
  readonly environmentId: string;
  readonly threadId: string;
}): { readonly text: string } {
  const bytes = Buffer.from(input.envelope, "base64url");
  if (bytes[0] !== 1) throw new Error("Unknown envelope version");
  const ephemeralRaw = bytes.subarray(1, 33);
  const nonce = bytes.subarray(33, 45);
  const ciphertext = bytes.subarray(45, bytes.length - 16);
  const tag = bytes.subarray(bytes.length - 16);
  const deviceRaw = Buffer.from(rawX25519PublicKey(input.devicePrivateKey), "base64url");
  const shared = NodeCrypto.diffieHellman({
    privateKey: input.devicePrivateKey,
    publicKey: NodeCrypto.createPublicKey({
      key: { kty: "OKP", crv: "X25519", x: ephemeralRaw.toString("base64url") },
      format: "jwk",
    }),
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
  const decipher = NodeCrypto.createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAAD(Buffer.from(`${input.environmentId}/${input.threadId}`, "utf8"));
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8"));
}
