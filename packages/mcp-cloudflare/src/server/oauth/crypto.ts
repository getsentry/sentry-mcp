/**
 * Cryptographic utilities for OAuth token and props management.
 *
 * This module provides:
 * - Random string generation for tokens, codes, and client IDs
 * - SHA-256 hashing for secrets and token validation
 * - AES-256-GCM encryption for props (Sentry tokens)
 * - Key wrapping to bind encryption keys to tokens/codes
 *
 * Security Model:
 * - Props are encrypted with a random AES-256-GCM key
 * - The encryption key is wrapped (encrypted) with a key derived from the token/code
 * - This ensures props can only be decrypted by someone with the valid token/code
 * - Tokens are hashed before storage to prevent exposure of the actual token values
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto
 */

import type { ParsedToken, WorkerProps } from "./types";

// =============================================================================
// Constants
// =============================================================================

/** Character set for random string generation (URL-safe) */
const CHARSET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** Length of authorization code secrets */
export const AUTH_CODE_SECRET_LENGTH = 32;

/** Length of access/refresh token secrets */
export const TOKEN_SECRET_LENGTH = 48;

/** Length of client IDs */
export const CLIENT_ID_LENGTH = 16;

/** Length of client secrets */
export const CLIENT_SECRET_LENGTH = 32;

/** Length of grant IDs */
export const GRANT_ID_LENGTH = 16;

// =============================================================================
// Random Generation
// =============================================================================

/**
 * Generate a cryptographically random string.
 *
 * Uses crypto.getRandomValues() for secure randomness.
 * Output is URL-safe (alphanumeric only).
 *
 * @param length - Length of string to generate
 * @returns Random alphanumeric string
 */
export function generateRandomString(length: number): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => CHARSET[byte % CHARSET.length]).join("");
}

/**
 * Generate a new client ID.
 */
export function generateClientId(): string {
  return generateRandomString(CLIENT_ID_LENGTH);
}

/**
 * Generate a new client secret.
 */
export function generateClientSecret(): string {
  return generateRandomString(CLIENT_SECRET_LENGTH);
}

/**
 * Generate a new grant ID.
 */
export function generateGrantId(): string {
  return generateRandomString(GRANT_ID_LENGTH);
}

/**
 * Generate an authorization code.
 *
 * Format: {userId}:{grantId}:{secret}
 *
 * This format allows:
 * - Extracting userId and grantId without database lookup
 * - Verifying the secret against stored hash
 * - Looking up the grant to get encrypted props
 *
 * @param userId - User ID from Sentry
 * @param grantId - Grant ID
 * @returns Authorization code string
 */
export function generateAuthCode(userId: string, grantId: string): string {
  const secret = generateRandomString(AUTH_CODE_SECRET_LENGTH);
  return `${userId}:${grantId}:${secret}`;
}

/**
 * Generate an access or refresh token.
 *
 * Format: {userId}:{grantId}:{secret}
 *
 * @param userId - User ID from Sentry
 * @param grantId - Grant ID
 * @returns Token string
 */
export function generateToken(userId: string, grantId: string): string {
  const secret = generateRandomString(TOKEN_SECRET_LENGTH);
  return `${userId}:${grantId}:${secret}`;
}

/**
 * Parse a token string into its components.
 *
 * @param token - Token string in format {userId}:{grantId}:{secret}
 * @returns Parsed components or null if invalid format
 */
export function parseToken(token: string): ParsedToken | null {
  const parts = token.split(":");
  if (parts.length !== 3) {
    return null;
  }

  const [userId, grantId, secret] = parts;
  if (!userId || !grantId || !secret) {
    return null;
  }

  return { userId, grantId, secret };
}

// =============================================================================
// Hashing
// =============================================================================

/**
 * Hash a secret using SHA-256.
 *
 * Used for:
 * - Storing client secrets (verify with verifySecret)
 * - Creating token IDs for storage keys
 * - Verifying authorization codes
 *
 * @param secret - Secret to hash
 * @returns Hex-encoded SHA-256 hash
 */
export async function hashSecret(secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(secret);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return bufferToHex(hashBuffer);
}

/**
 * Verify a secret against its hash.
 *
 * Uses timing-safe comparison to prevent timing attacks.
 *
 * @param secret - Secret to verify
 * @param hash - Expected hash
 * @returns True if secret matches hash
 */
export async function verifySecret(
  secret: string,
  hash: string,
): Promise<boolean> {
  const computed = await hashSecret(secret);
  return timingSafeEqual(computed, hash);
}

/**
 * Generate a token ID from the full token string.
 *
 * The token ID is used as part of the storage key.
 * It's a hash of the full token to prevent enumeration.
 *
 * @param token - Full token string
 * @returns Token ID (hash)
 */
export async function generateTokenId(token: string): Promise<string> {
  return hashSecret(token);
}

// =============================================================================
// Encryption (AES-256-GCM)
// =============================================================================

/**
 * Encrypted data structure.
 */
export interface EncryptedData {
  /** Base64-encoded ciphertext */
  ciphertext: string;
  /** Base64-encoded initialization vector (12 bytes) */
  iv: string;
}

/**
 * Generate a random AES-256-GCM encryption key.
 *
 * @returns CryptoKey for encryption/decryption
 */
export async function generateEncryptionKey(): Promise<CryptoKey> {
  // AES-GCM always returns a single CryptoKey (not CryptoKeyPair)
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]) as Promise<CryptoKey>;
}

/**
 * Encrypt props using AES-256-GCM.
 *
 * Props contain sensitive data (Sentry access/refresh tokens) and must
 * be encrypted at rest. A random IV is generated for each encryption.
 *
 * @param props - Props to encrypt
 * @param key - AES-256-GCM encryption key
 * @returns Encrypted data with IV
 */
export async function encryptProps(
  props: WorkerProps,
  key: CryptoKey,
): Promise<EncryptedData> {
  // Generate random 12-byte IV (recommended for GCM)
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Encode props as JSON
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(props));

  // Encrypt with AES-256-GCM
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    data,
  );

  return {
    ciphertext: arrayBufferToBase64(ciphertext),
    iv: arrayBufferToBase64(iv),
  };
}

/**
 * Decrypt props using AES-256-GCM.
 *
 * @param encrypted - Encrypted data with IV
 * @param key - AES-256-GCM encryption key
 * @returns Decrypted props
 * @throws Error if decryption fails (wrong key, corrupted data, etc.)
 */
export async function decryptProps(
  encrypted: EncryptedData,
  key: CryptoKey,
): Promise<WorkerProps> {
  const ciphertext = base64ToArrayBuffer(encrypted.ciphertext);
  const iv = base64ToArrayBuffer(encrypted.iv);

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(iv) },
    key,
    ciphertext,
  );

  const decoder = new TextDecoder();
  const json = decoder.decode(decrypted);
  return JSON.parse(json) as WorkerProps;
}

/**
 * Encrypt props and return both the encrypted data and the encryption key.
 *
 * Convenience function that generates a new key and encrypts in one call.
 *
 * @param props - Props to encrypt
 * @returns Encrypted data and encryption key
 */
export async function encryptPropsWithNewKey(
  props: WorkerProps,
): Promise<{ encrypted: EncryptedData; key: CryptoKey }> {
  const key = await generateEncryptionKey();
  const encrypted = await encryptProps(props, key);
  return { encrypted, key };
}

// =============================================================================
// Key Wrapping
// =============================================================================

/**
 * Derive a wrapping key from a token or authorization code.
 *
 * Uses PBKDF2 to derive a key from the token string.
 * This binds the encryption key to the specific token, so props
 * can only be decrypted by someone with the valid token.
 *
 * Note: We use a fixed salt because the token itself provides sufficient
 * entropy and uniqueness. The salt's purpose (preventing rainbow tables)
 * is already satisfied by the random token value.
 *
 * @param token - Token or authorization code string
 * @returns CryptoKey suitable for AES-KW (key wrapping)
 */
async function deriveWrappingKey(token: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const tokenData = encoder.encode(token);

  // Import token as key material for PBKDF2
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    tokenData,
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  // Fixed salt - token provides uniqueness
  const salt = encoder.encode("sentry-mcp-oauth-key-wrap");

  // Derive a key suitable for AES-KW
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-KW", length: 256 },
    false,
    ["wrapKey", "unwrapKey"],
  );
}

/**
 * Wrap an encryption key with a token.
 *
 * The wrapped key can only be unwrapped by someone with the original token.
 * Uses AES-KW (Key Wrap) algorithm.
 *
 * @param token - Token or authorization code to bind the key to
 * @param key - Encryption key to wrap
 * @returns Base64-encoded wrapped key
 */
export async function wrapKeyWithToken(
  token: string,
  key: CryptoKey,
): Promise<string> {
  const wrappingKey = await deriveWrappingKey(token);

  const wrapped = await crypto.subtle.wrapKey(
    "raw",
    key,
    wrappingKey,
    "AES-KW",
  );

  return arrayBufferToBase64(wrapped);
}

/**
 * Unwrap an encryption key using a token.
 *
 * @param token - Token or authorization code
 * @param wrappedKey - Base64-encoded wrapped key
 * @returns Unwrapped encryption key
 * @throws Error if token doesn't match (wrong token, corrupted data)
 */
export async function unwrapKeyWithToken(
  token: string,
  wrappedKey: string,
): Promise<CryptoKey> {
  const wrappingKey = await deriveWrappingKey(token);
  const wrappedBuffer = base64ToArrayBuffer(wrappedKey);

  return crypto.subtle.unwrapKey(
    "raw",
    wrappedBuffer,
    wrappingKey,
    "AES-KW",
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
}

// =============================================================================
// PKCE (RFC 7636)
// =============================================================================

/**
 * Verify a PKCE code verifier against a code challenge.
 *
 * @see RFC 7636 Section 4.6 - Server Verifies code_verifier
 *
 * @param codeVerifier - Code verifier from token request
 * @param codeChallenge - Code challenge from authorization request
 * @param method - Challenge method: 'plain' or 'S256'
 * @returns True if verifier matches challenge
 */
export async function verifyCodeChallenge(
  codeVerifier: string,
  codeChallenge: string,
  method: string,
): Promise<boolean> {
  if (method === "plain") {
    // RFC 7636 Section 4.6: plain comparison
    return codeVerifier === codeChallenge;
  }

  if (method === "S256") {
    // RFC 7636 Section 4.6: BASE64URL(SHA256(code_verifier))
    const encoder = new TextEncoder();
    const data = encoder.encode(codeVerifier);
    const hash = await crypto.subtle.digest("SHA-256", data);
    const computed = base64UrlEncode(hash);
    return computed === codeChallenge;
  }

  // Unknown method
  return false;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Convert ArrayBuffer to hex string.
 */
function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Convert ArrayBuffer to base64 string.
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert base64 string to ArrayBuffer.
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Base64URL encode (RFC 7636 Appendix A).
 *
 * @see RFC 7636 Appendix A - Notes on Implementing Base64url Encoding without Padding
 */
function base64UrlEncode(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Timing-safe string comparison.
 *
 * Compares two strings in constant time to prevent timing attacks.
 * Both strings should be the same length (e.g., hex-encoded hashes).
 *
 * @param a - First string
 * @param b - Second string
 * @returns True if strings are equal
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
