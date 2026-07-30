import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decryptGoogleSecret,
  encryptGoogleSecret
} from "./google-drive-crypto";

describe("Google Drive token encryption", () => {
  const previousKey = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = "ab".repeat(32);
  });

  afterEach(() => {
    if (previousKey === undefined) {
      delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
    } else {
      process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = previousKey;
    }
  });

  it("round-trips a refresh token with authenticated encryption", () => {
    const encrypted = encryptGoogleSecret("refresh-token-value");
    expect(encrypted).not.toContain("refresh-token-value");
    expect(decryptGoogleSecret(encrypted)).toBe("refresh-token-value");
  });

  it("uses a random nonce for every encryption", () => {
    const first = encryptGoogleSecret("same-value");
    const second = encryptGoogleSecret("same-value");
    expect(first).not.toBe(second);
  });

  it("rejects ciphertext that has been modified", () => {
    const encrypted = encryptGoogleSecret("refresh-token-value");
    const tampered = `${encrypted.slice(0, -1)}${
      encrypted.endsWith("a") ? "b" : "a"
    }`;
    expect(() => decryptGoogleSecret(tampered)).toThrow();
  });
});
