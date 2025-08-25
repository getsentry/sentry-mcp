/**
 * Cryptographic utilities for OAuth 2.1 provider
 * Uses Web Crypto API available in Cloudflare Workers
 * 
 * @see https://datatracker.ietf.org/doc/html/rfc6749#section-2.3.1 - Client Password Authentication
 * @see https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics#section-3.2.1 - Password Storage
 * @see https://datatracker.ietf.org/doc/html/rfc2898 - PKCS #5: Password-Based Cryptography Specification
 * @see https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html - OWASP Password Storage
 */

/**
 * Hash a client secret using PBKDF2 with SHA-256
 * 
 * @see https://datatracker.ietf.org/doc/html/rfc2898#section-5.2 - PBKDF2
 * @see https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#pbkdf2
 * 
 * @param secret - The plain text secret to hash
 * @param salt - Optional salt (will generate if not provided)
 * @returns Hash string in format: pbkdf2$iterations$salt$hash
 */
export async function hashClientSecret(
  secret: string,
  salt?: string
): Promise<string> {
  const iterations = 50000; // Balanced for OAuth clients (automated, not human)
  const encoder = new TextEncoder();
  
  // Generate salt if not provided
  if (!salt) {
    const saltBytes = new Uint8Array(16);
    crypto.getRandomValues(saltBytes);
    salt = btoa(String.fromCharCode(...saltBytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }
  
  // Import the secret as a key
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  
  // Derive bits using PBKDF2
  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: encoder.encode(salt),
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    256 // 32 bytes
  );
  
  // Convert to base64url
  const hashArray = new Uint8Array(hashBuffer);
  const hash = btoa(String.fromCharCode(...hashArray))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  
  // Return in format: algorithm$iterations$salt$hash
  return `pbkdf2$${iterations}$${salt}$${hash}`;
}

/**
 * Verify a client secret against a stored hash
 * 
 * @param secret - The plain text secret to verify
 * @param storedHash - The stored hash to verify against
 * @returns True if the secret matches the hash
 */
export async function verifyClientSecret(
  secret: string,
  storedHash: string
): Promise<boolean> {
  try {
    // Parse stored hash format: pbkdf2$iterations$salt$hash
    const parts = storedHash.split('$');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2') {
      // Legacy plain text comparison (for backwards compatibility during migration)
      // In production, this should return false after migration
      return secret === storedHash;
    }
    
    const [, iterationsStr, salt, expectedHash] = parts;
    const iterations = parseInt(iterationsStr, 10);
    
    // Hash the provided secret with the same salt and iterations
    const encoder = new TextEncoder();
    
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      'PBKDF2',
      false,
      ['deriveBits']
    );
    
    const hashBuffer = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: encoder.encode(salt),
        iterations,
        hash: 'SHA-256',
      },
      keyMaterial,
      256
    );
    
    // Convert to base64url
    const hashArray = new Uint8Array(hashBuffer);
    const hash = btoa(String.fromCharCode(...hashArray))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    
    // Constant-time comparison
    return constantTimeEqual(hash, expectedHash);
  } catch (error) {
    console.error('[OAuth] Error verifying client secret:', error);
    return false;
  }
}

/**
 * Constant-time string comparison to prevent timing attacks
 * @see https://codahale.com/a-lesson-in-timing-attacks/ - Timing Attack Prevention
 * @see https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics#section-3.2.3 - Timing Attacks
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  
  return result === 0;
}

/**
 * Generate a cryptographically secure client secret
 * 
 * @see https://datatracker.ietf.org/doc/html/rfc6749#section-2.3.1 - Client Password
 * @see https://datatracker.ietf.org/doc/html/rfc4086#section-5 - Randomness Requirements
 * 
 * @param length - Length of the secret (default: 32 characters)
 * @returns A secure random string
 */
export function generateClientSecret(length: number = 32): string {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const values = new Uint8Array(length);
  crypto.getRandomValues(values);
  
  let secret = '';
  for (let i = 0; i < length; i++) {
    secret += charset[values[i] % charset.length];
  }
  
  return secret;
}