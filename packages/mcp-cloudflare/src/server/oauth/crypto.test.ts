import { describe, expect, it } from "vitest";
import {
  AUTH_CODE_SECRET_LENGTH,
  CLIENT_ID_LENGTH,
  CLIENT_SECRET_LENGTH,
  GRANT_ID_LENGTH,
  TOKEN_SECRET_LENGTH,
  decryptProps,
  encryptProps,
  encryptPropsWithNewKey,
  generateAuthCode,
  generateClientId,
  generateClientSecret,
  generateEncryptionKey,
  generateGrantId,
  generateRandomString,
  generateToken,
  generateTokenId,
  hashSecret,
  parseToken,
  unwrapKeyWithToken,
  verifyCodeChallenge,
  verifySecret,
  wrapKeyWithToken,
} from "./crypto";
import type { WorkerProps } from "./types";

describe("crypto utilities", () => {
  describe("generateRandomString", () => {
    it("generates string of correct length", () => {
      expect(generateRandomString(16)).toHaveLength(16);
      expect(generateRandomString(32)).toHaveLength(32);
      expect(generateRandomString(64)).toHaveLength(64);
    });

    it("generates URL-safe characters only", () => {
      const str = generateRandomString(100);
      expect(str).toMatch(/^[A-Za-z0-9]+$/);
    });

    it("generates unique strings", () => {
      const strings = new Set(
        Array.from({ length: 100 }, () => generateRandomString(16)),
      );
      expect(strings.size).toBe(100);
    });
  });

  describe("ID generation", () => {
    it("generateClientId creates correct length", () => {
      expect(generateClientId()).toHaveLength(CLIENT_ID_LENGTH);
    });

    it("generateClientSecret creates correct length", () => {
      expect(generateClientSecret()).toHaveLength(CLIENT_SECRET_LENGTH);
    });

    it("generateGrantId creates correct length", () => {
      expect(generateGrantId()).toHaveLength(GRANT_ID_LENGTH);
    });
  });

  describe("generateAuthCode", () => {
    it("creates code in correct format", () => {
      const code = generateAuthCode("user123", "grant456");
      const parts = code.split(":");
      expect(parts).toHaveLength(3);
      expect(parts[0]).toBe("user123");
      expect(parts[1]).toBe("grant456");
      expect(parts[2]).toHaveLength(AUTH_CODE_SECRET_LENGTH);
    });
  });

  describe("generateToken", () => {
    it("creates token in correct format", () => {
      const token = generateToken("user123", "grant456");
      const parts = token.split(":");
      expect(parts).toHaveLength(3);
      expect(parts[0]).toBe("user123");
      expect(parts[1]).toBe("grant456");
      expect(parts[2]).toHaveLength(TOKEN_SECRET_LENGTH);
    });
  });

  describe("parseToken", () => {
    it("parses valid token", () => {
      const token = generateToken("user123", "grant456");
      const parsed = parseToken(token);
      expect(parsed).not.toBeNull();
      expect(parsed!.userId).toBe("user123");
      expect(parsed!.grantId).toBe("grant456");
      expect(parsed!.secret).toHaveLength(TOKEN_SECRET_LENGTH);
    });

    it("returns null for invalid token format", () => {
      expect(parseToken("invalid")).toBeNull();
      expect(parseToken("user:grant")).toBeNull();
      expect(parseToken("")).toBeNull();
    });

    it("rejects tokens with extra colons", () => {
      // Token format is strictly userId:grantId:secret (exactly 3 parts)
      // Tokens with colons in userId/grantId are invalid
      const token = "user:with:colons:grant456:secret";
      const parsed = parseToken(token);
      expect(parsed).toBeNull();
    });
  });

  describe("hashSecret", () => {
    it("produces consistent hash for same input", async () => {
      const hash1 = await hashSecret("test-secret");
      const hash2 = await hashSecret("test-secret");
      expect(hash1).toBe(hash2);
    });

    it("produces different hashes for different inputs", async () => {
      const hash1 = await hashSecret("secret1");
      const hash2 = await hashSecret("secret2");
      expect(hash1).not.toBe(hash2);
    });

    it("produces hex string", async () => {
      const hash = await hashSecret("test");
      expect(hash).toMatch(/^[a-f0-9]+$/);
    });
  });

  describe("verifySecret", () => {
    it("returns true for matching secret and hash", async () => {
      const secret = "my-secret-value";
      const hash = await hashSecret(secret);
      const result = await verifySecret(secret, hash);
      expect(result).toBe(true);
    });

    it("returns false for non-matching secret", async () => {
      const hash = await hashSecret("original-secret");
      const result = await verifySecret("wrong-secret", hash);
      expect(result).toBe(false);
    });

    it("returns false for empty secret against valid hash", async () => {
      const hash = await hashSecret("original-secret");
      const result = await verifySecret("", hash);
      expect(result).toBe(false);
    });
  });

  describe("generateTokenId", () => {
    it("produces consistent ID for same token", async () => {
      const token = generateToken("user", "grant");
      const id1 = await generateTokenId(token);
      const id2 = await generateTokenId(token);
      expect(id1).toBe(id2);
    });
  });

  describe("encryption", () => {
    const testProps: WorkerProps = {
      id: "user-123",
      accessToken: "sentry-access-token",
      refreshToken: "sentry-refresh-token",
      clientId: "client-id",
      scope: "org:read project:read",
      grantedSkills: ["issues", "projects"],
    };

    describe("generateEncryptionKey", () => {
      it("generates AES-GCM key", async () => {
        const key = await generateEncryptionKey();
        expect(key.algorithm.name).toBe("AES-GCM");
      });
    });

    describe("encryptProps/decryptProps", () => {
      it("round-trips props correctly", async () => {
        const key = await generateEncryptionKey();
        const encrypted = await encryptProps(testProps, key);

        expect(encrypted.ciphertext).toBeTruthy();
        expect(encrypted.iv).toBeTruthy();

        const decrypted = await decryptProps(encrypted, key);
        expect(decrypted).toEqual(testProps);
      });

      it("produces different ciphertext each time", async () => {
        const key = await generateEncryptionKey();
        const encrypted1 = await encryptProps(testProps, key);
        const encrypted2 = await encryptProps(testProps, key);

        // IVs should be different
        expect(encrypted1.iv).not.toBe(encrypted2.iv);
        // Ciphertext should be different due to different IV
        expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);
      });

      it("fails with wrong key", async () => {
        const key1 = await generateEncryptionKey();
        const key2 = await generateEncryptionKey();
        const encrypted = await encryptProps(testProps, key1);

        await expect(decryptProps(encrypted, key2)).rejects.toThrow();
      });
    });

    describe("encryptPropsWithNewKey", () => {
      it("returns encrypted props and key", async () => {
        const result = await encryptPropsWithNewKey(testProps);

        expect(result.encrypted.ciphertext).toBeTruthy();
        expect(result.encrypted.iv).toBeTruthy();
        expect(result.key.algorithm.name).toBe("AES-GCM");

        // Verify we can decrypt with returned key
        const decrypted = await decryptProps(result.encrypted, result.key);
        expect(decrypted).toEqual(testProps);
      });
    });
  });

  describe("key wrapping", () => {
    it("round-trips key correctly", async () => {
      const token = generateToken("user", "grant");
      const key = await generateEncryptionKey();

      const wrapped = await wrapKeyWithToken(token, key);
      expect(wrapped).toBeTruthy();

      const unwrapped = await unwrapKeyWithToken(token, wrapped);
      expect(unwrapped.algorithm.name).toBe("AES-GCM");
    });

    it("fails with wrong token", async () => {
      const token1 = generateToken("user", "grant");
      const token2 = generateToken("user", "grant");
      const key = await generateEncryptionKey();

      const wrapped = await wrapKeyWithToken(token1, key);

      await expect(unwrapKeyWithToken(token2, wrapped)).rejects.toThrow();
    });
  });

  describe("verifyCodeChallenge (PKCE)", () => {
    describe("plain method", () => {
      it("verifies matching verifier", async () => {
        const verifier = "test-verifier";
        const challenge = verifier; // plain method: challenge === verifier

        const result = await verifyCodeChallenge(verifier, challenge, "plain");
        expect(result).toBe(true);
      });

      it("rejects non-matching verifier", async () => {
        const result = await verifyCodeChallenge(
          "wrong",
          "test-verifier",
          "plain",
        );
        expect(result).toBe(false);
      });
    });

    describe("S256 method", () => {
      it("verifies correct S256 challenge", async () => {
        // The verifier is hashed with SHA-256 and base64url encoded to create challenge
        const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        // SHA-256 hash of verifier, base64url encoded
        const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

        const result = await verifyCodeChallenge(verifier, challenge, "S256");
        expect(result).toBe(true);
      });

      it("rejects wrong verifier", async () => {
        const result = await verifyCodeChallenge(
          "wrong-verifier",
          "some-challenge",
          "S256",
        );
        expect(result).toBe(false);
      });
    });
  });
});
