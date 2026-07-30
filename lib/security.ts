import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dataDirectory } from "@/lib/db";

function getApplicationSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;

  const secretPath = path.join(dataDirectory, ".session-secret");
  if (!existsSync(secretPath)) {
    writeFileSync(secretPath, randomBytes(48).toString("base64url"), {
      mode: 0o600,
    });
  }
  return readFileSync(secretPath, "utf8").trim();
}

export function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `scrypt:${salt.toString("base64url")}:${derived.toString("base64url")}`;
}

export function verifyPassword(password: string, encoded: string | null) {
  if (!encoded) return false;
  const [algorithm, saltValue, hashValue] = encoded.split(":");
  if (algorithm !== "scrypt" || !saltValue || !hashValue) return false;

  try {
    const salt = Buffer.from(saltValue, "base64url");
    const expected = Buffer.from(hashValue, "base64url");
    const received = scryptSync(password, salt, expected.length);
    return (
      received.length === expected.length &&
      timingSafeEqual(received, expected)
    );
  } catch {
    return false;
  }
}

function encryptionKey() {
  return createHash("sha256")
    .update(`ldap-config:${getApplicationSecret()}`)
    .digest();
}

export function encryptSecret(value: string) {
  if (!value) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

export function decryptSecret(value: string) {
  if (!value) return "";
  const [version, ivValue, tagValue, encryptedValue] = value.split(":");
  if (
    version !== "v1" ||
    !ivValue ||
    !tagValue ||
    encryptedValue === undefined
  ) {
    throw new Error("LDAP 密码配置无法解密，请重新保存");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export { getApplicationSecret };
