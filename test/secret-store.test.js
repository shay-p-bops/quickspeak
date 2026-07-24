import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  decryptSecret,
  encryptSecret,
  generateEncryptionKey
} from "../src/secret-store.js";

test("API keys are encrypted with a non-extractable AES-GCM key", async () => {
  const key = await generateEncryptionKey(webcrypto);
  assert.equal(key.extractable, false);
  assert.equal(key.algorithm.name, "AES-GCM");

  const encrypted = await encryptSecret("sk-sensitive", key, webcrypto);
  assert.equal(encrypted.version, 1);
  assert.equal(encrypted.algorithm, "AES-GCM");
  assert.notEqual(encrypted.ciphertext, "sk-sensitive");
  assert.equal(await decryptSecret(encrypted, key, webcrypto), "sk-sensitive");
});

test("AES-GCM rejects tampered encrypted payloads", async () => {
  const key = await generateEncryptionKey(webcrypto);
  const encrypted = await encryptSecret("sk-sensitive", key, webcrypto);
  const tampered = {
    ...encrypted,
    ciphertext: `${encrypted.ciphertext.slice(0, -2)}AA`
  };

  await assert.rejects(decryptSecret(tampered, key, webcrypto));
});

test("invalid encrypted payloads are rejected before decryption", async () => {
  const key = await generateEncryptionKey(webcrypto);
  await assert.rejects(
    decryptSecret({ version: 99 }, key, webcrypto),
    /invalid/
  );
});
