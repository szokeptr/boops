import { assert, describe, it } from "@effect/vitest";

import { notificationPreviewText, sealNotificationPreview } from "./notificationPreviewSeal.ts";
import {
  makeDeviceKey,
  openNotificationPreview,
  rawX25519PublicKey,
  x25519PrivateKeyFromRaw,
} from "./notificationPreviewSeal.testkit.ts";

// Fixed vector for checking the iOS decryptor. Keys are RFC 7748 §6.1's (Bob is the device).
const VECTOR = {
  devicePrivateKeyHex: "5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb",
  devicePublicKey: "3p7bfXt9wbTTW2HC7OQ1Nz-DQ8hbeGdNrfx-FG-IK08",
  ephemeralPrivateKeyHex: "77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a",
  nonceHex: "000102030405060708090a0b",
  environmentId: "env-test-vector",
  threadId: "thread-test-vector",
  plaintext: '{"text":"Hello from Pip 👋"}',
  // Intermediates for debugging another implementation; the HKDF key was checked with `openssl kdf`.
  sharedSecretHex: "4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742",
  aesKeyHex: "6da021386b7bfddd1ac06dfa1a7ac62aa90b26fb71cfdffefb9af7c14daae389",
  envelope:
    "AYUg8AmJMKdUdIt93LQ-91oNvzoNJjga9OukqY6qm05qAAECAwQFBgcICQoLA4UGv_RLxhpNnXOdfT0c-MIPZzMJXnZs2KlX2NoJRruXyPvF8FXYKXSDNFRboA",
};

const environmentId = "environment-1";
const threadId = "thread-1";

describe("sealNotificationPreview", () => {
  it("opens with the device key and only for the same thread", () => {
    const device = makeDeviceKey();
    const envelope = sealNotificationPreview({
      devicePublicKey: device.publicKey,
      environmentId,
      threadId,
      text: "Your **report** is ready:\n\n- [the link](https://example.test)",
    });
    assert.match(envelope, /^[A-Za-z0-9_-]+$/);
    const bytes = Buffer.from(envelope, "base64url");
    const plaintext = '{"text":"Your report is ready: the link"}';
    assert.equal(bytes.length, 1 + 32 + 12 + Buffer.byteLength(plaintext) + 16);
    assert.equal(bytes[0], 1);
    assert.deepEqual(
      openNotificationPreview({
        envelope,
        devicePrivateKey: device.privateKey,
        environmentId,
        threadId,
      }),
      { text: "Your report is ready: the link" },
    );
    assert.throws(() =>
      openNotificationPreview({
        envelope,
        devicePrivateKey: device.privateKey,
        environmentId,
        threadId: "thread-2",
      }),
    );
    assert.throws(() =>
      openNotificationPreview({
        envelope,
        devicePrivateKey: makeDeviceKey().privateKey,
        environmentId,
        threadId,
      }),
    );
  });

  it("matches the fixed test vector", () => {
    const devicePrivateKey = x25519PrivateKeyFromRaw(
      Buffer.from(VECTOR.devicePrivateKeyHex, "hex"),
    );
    assert.equal(rawX25519PublicKey(devicePrivateKey), VECTOR.devicePublicKey);
    const envelope = sealNotificationPreview({
      devicePublicKey: VECTOR.devicePublicKey,
      environmentId: VECTOR.environmentId,
      threadId: VECTOR.threadId,
      text: JSON.parse(VECTOR.plaintext).text,
      ephemeralPrivateKey: x25519PrivateKeyFromRaw(
        Buffer.from(VECTOR.ephemeralPrivateKeyHex, "hex"),
      ),
      nonce: Buffer.from(VECTOR.nonceHex, "hex"),
    });
    assert.equal(envelope, VECTOR.envelope);
    assert.deepEqual(
      openNotificationPreview({
        envelope,
        devicePrivateKey,
        environmentId: VECTOR.environmentId,
        threadId: VECTOR.threadId,
      }),
      JSON.parse(VECTOR.plaintext),
    );
  });
});

describe("notificationPreviewText", () => {
  it.each([
    ["# Title\n\n> quoted\n\n* item one\n* [x] done", "Title quoted item one done"],
    ["Use `vp test` and ~~not~~ __this__", "Use vp test and not this"],
    ["```ts\nconst a = 1;\n```", "const a = 1;"],
    ["![chart](https://x.test/c.png) attached", "chart attached"],
  ])("strips markdown from %j", (input, expected) => {
    assert.equal(notificationPreviewText(input), expected);
  });

  it("truncates on a code point boundary", () => {
    const text = notificationPreviewText(`${"a".repeat(198)}😀😀😀`);
    assert.equal(Array.from(text).length, 200);
    assert.isTrue(text.endsWith("a😀…"));
  });
});
