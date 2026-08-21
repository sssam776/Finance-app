import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Token-set encryption using Node's `crypto` (AES-256-GCM). The master spec
 * requires Cloudflare Web Crypto in Worker code (8.6) — this is the
 * quick-version stand-in for local/Node development and must be swapped for
 * a Web Crypto implementation behind the same encrypt/decrypt signature
 * before deploying to a Worker (see ADR-002). The key-version envelope is
 * already in place so that swap does not require a data migration.
 */

const ALGORITHM = "aes-256-gcm";
export const CURRENT_KEY_VERSION = 1;

function getKey(version: number): Buffer {
  const envVar = `XERO_TOKEN_ENCRYPTION_KEY_V${version}`;
  const raw = process.env[envVar];
  if (!raw) {
    throw new Error(
      `Missing ${envVar}. Set a 32-byte base64 key before enabling Xero OAuth (see .env.example).`
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(`${envVar} must decode to exactly 32 bytes, got ${key.length}.`);
  }
  return key;
}

export interface EncryptedPayload {
  keyVersion: number;
  iv: string;
  authTag: string;
  ciphertext: string;
}

export function encryptTokenSet(plaintext: string, keyVersion = CURRENT_KEY_VERSION): EncryptedPayload {
  const key = getKey(keyVersion);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    keyVersion,
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function decryptTokenSet(payload: EncryptedPayload): string {
  const key = getKey(payload.keyVersion);
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf-8");
}

export function serializeEncryptedPayload(payload: EncryptedPayload): string {
  return JSON.stringify(payload);
}

export function deserializeEncryptedPayload(serialized: string): EncryptedPayload {
  return JSON.parse(serialized) as EncryptedPayload;
}
