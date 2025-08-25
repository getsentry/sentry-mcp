/**
 * Encrypted Context Storage for OAuth 2.1 Provider
 * 
 * Implements end-to-end encryption for sensitive application-specific context.
 * This is critical for OAuth proxy scenarios where upstream tokens are stored.
 * 
 * Security Design:
 * - Each grant has its own unique AES-256 encryption key
 * - Keys are wrapped (encrypted) using tokens as key material
 * - Only holders of valid tokens can decrypt the context
 * - Uses AES-GCM for authenticated encryption
 * - Constant IV is safe because each key is used only once
 */

/**
 * Generate a new AES-256 encryption key for a grant
 */
export async function generateEncryptionKey(): Promise<CryptoKey> {
  const key = await crypto.subtle.generateKey(
    {
      name: 'AES-GCM',
      length: 256,
    },
    true, // extractable for wrapping
    ['encrypt', 'decrypt']
  );
  return key as CryptoKey;
}

/**
 * Derive a wrapping key from a token
 * Uses HMAC-SHA256 to derive a key from the token
 */
async function deriveWrappingKey(token: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const tokenData = encoder.encode(token);
  
  // Import token as HMAC key material
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    tokenData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  // Generate HMAC to get key material
  const hmac = await crypto.subtle.sign('HMAC', keyMaterial, tokenData);
  
  // Import HMAC result as AES key for wrapping
  return await crypto.subtle.importKey(
    'raw',
    hmac.slice(0, 32), // Use first 256 bits
    { name: 'AES-KW' },
    false,
    ['wrapKey', 'unwrapKey']
  );
}

/**
 * Wrap (encrypt) an encryption key using a token
 * 
 * @param encryptionKey - The AES key to wrap
 * @param token - The token to use as wrapping key material
 * @returns Base64-encoded wrapped key
 */
export async function wrapEncryptionKey(
  encryptionKey: CryptoKey,
  token: string
): Promise<string> {
  const wrappingKey = await deriveWrappingKey(token);
  
  const wrappedKey = await crypto.subtle.wrapKey(
    'raw',
    encryptionKey,
    wrappingKey,
    'AES-KW'
  );
  
  // Convert to base64 for storage
  return btoa(String.fromCharCode(...new Uint8Array(wrappedKey)));
}

/**
 * Unwrap (decrypt) an encryption key using a token
 * 
 * @param wrappedKey - Base64-encoded wrapped key
 * @param token - The token to use as unwrapping key material
 * @returns The unwrapped AES key
 */
export async function unwrapEncryptionKey(
  wrappedKey: string,
  token: string
): Promise<CryptoKey> {
  const wrappingKey = await deriveWrappingKey(token);
  
  // Convert from base64
  const wrappedKeyBuffer = Uint8Array.from(atob(wrappedKey), c => c.charCodeAt(0));
  
  return await crypto.subtle.unwrapKey(
    'raw',
    wrappedKeyBuffer,
    wrappingKey,
    'AES-KW',
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt context using AES-GCM
 * 
 * @param context - The context object to encrypt
 * @param encryptionKey - The AES key to use
 * @returns Object with encrypted data and IV (both base64-encoded)
 */
export async function encryptContext(
  context: any,
  encryptionKey: CryptoKey
): Promise<{ encryptedData: string; iv: string }> {
  const encoder = new TextEncoder();
  const contextJson = JSON.stringify(context);
  const contextData = encoder.encode(contextJson);
  
  // Use a constant zero IV since each key is only used once
  // This is cryptographically safe and simpler than random IVs
  const iv = new Uint8Array(12); // 96 bits of zeros
  
  const encryptedBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv,
    },
    encryptionKey,
    contextData
  );
  
  return {
    encryptedData: btoa(String.fromCharCode(...new Uint8Array(encryptedBuffer))),
    iv: btoa(String.fromCharCode(...iv)),
  };
}

/**
 * Decrypt context using AES-GCM
 * 
 * @param encryptedData - Base64-encoded encrypted data
 * @param iv - Base64-encoded initialization vector
 * @param encryptionKey - The AES key to use
 * @returns The decrypted context object
 */
export async function decryptContext(
  encryptedData: string,
  iv: string,
  encryptionKey: CryptoKey
): Promise<any> {
  // Convert from base64
  const encryptedBuffer = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));
  const ivBuffer = Uint8Array.from(atob(iv), c => c.charCodeAt(0));
  
  const decryptedBuffer = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: ivBuffer,
    },
    encryptionKey,
    encryptedBuffer
  );
  
  const decoder = new TextDecoder();
  const contextJson = decoder.decode(decryptedBuffer);
  return JSON.parse(contextJson);
}

/**
 * Complete encryption flow for storing context with a new grant
 * 
 * @param context - The context to encrypt
 * @param token - The token (auth code, access token, or refresh token) to use for key wrapping
 * @returns Object with encrypted context and wrapped key for storage
 */
export async function encryptContextForStorage(
  context: any,
  token: string
): Promise<{
  encryptedContext: string;
  wrappedKey: string;
  iv: string;
}> {
  // Generate a new encryption key for this grant
  const encryptionKey = await generateEncryptionKey();
  
  // Encrypt the context
  const { encryptedData, iv } = await encryptContext(context, encryptionKey);
  
  // Wrap the encryption key with the token
  const wrappedKey = await wrapEncryptionKey(encryptionKey, token);
  
  return {
    encryptedContext: encryptedData,
    wrappedKey,
    iv,
  };
}

/**
 * Complete decryption flow for retrieving context
 * 
 * @param encryptedContext - Base64-encoded encrypted context
 * @param wrappedKey - Base64-encoded wrapped encryption key
 * @param iv - Base64-encoded initialization vector
 * @param token - The token to use for key unwrapping
 * @returns The decrypted context object
 */
export async function decryptContextFromStorage(
  encryptedContext: string,
  wrappedKey: string,
  iv: string,
  token: string
): Promise<any> {
  // Unwrap the encryption key using the token
  const encryptionKey = await unwrapEncryptionKey(wrappedKey, token);
  
  // Decrypt the context
  return await decryptContext(encryptedContext, iv, encryptionKey);
}