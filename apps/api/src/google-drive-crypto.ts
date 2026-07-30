import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual
} from "node:crypto";

const VERSION = "v1";

function encryptionKey() {
  const value = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY?.trim();
  if (!value || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY_NOT_CONFIGURED");
  }
  return Buffer.from(value, "hex");
}

export function encryptGoogleSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url")
  ].join(".");
}

export function decryptGoogleSecret(value: string) {
  const [version, ivValue, tagValue, encryptedValue] = value.split(".");
  if (
    version !== VERSION ||
    !ivValue ||
    !tagValue ||
    encryptedValue === undefined
  ) {
    throw new Error("INVALID_ENCRYPTED_GOOGLE_SECRET");
  }
  const iv = Buffer.from(ivValue, "base64url");
  const tag = Buffer.from(tagValue, "base64url");
  const encrypted = Buffer.from(encryptedValue, "base64url");
  if (iv.length !== 12 || tag.length !== 16) {
    throw new Error("INVALID_ENCRYPTED_GOOGLE_SECRET");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final()
  ]).toString("utf8");
}

export function safeGoogleStateEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}
