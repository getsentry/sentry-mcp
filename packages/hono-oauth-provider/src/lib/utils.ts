/**
 * Utility functions for OAuth provider
 */

/**
 * Escape HTML special characters to prevent XSS
 */
export function escapeHtml(str: string): string {
  const htmlEscapes: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '/': '&#x2F;',
  };
  
  return str.replace(/[&<>"'\/]/g, (char) => htmlEscapes[char]);
}

/**
 * Generate cryptographically secure random token with sufficient entropy
 * Returns base64url encoded string with at least 128 bits of entropy
 */
export function generateSecureToken(): string {
  // Generate 32 bytes (256 bits) for extra security
  const buffer = new Uint8Array(32);
  crypto.getRandomValues(buffer);
  
  // Convert to base64url
  const base64 = btoa(String.fromCharCode(...buffer));
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Generate a structured access token in the format userId:grantId:secret
 * This format allows efficient validation and revocation
 * 
 * @param userId - The user ID
 * @param grantId - The grant ID
 * @returns A structured token string
 */
export function generateStructuredToken(userId: string, grantId: string): string {
  const secret = generateSecureToken();
  return `${userId}:${grantId}:${secret}`;
}

/**
 * Parse a structured token into its components
 * 
 * @param token - The token to parse
 * @returns The parsed components or null if invalid format
 */
export function parseStructuredToken(token: string): { userId: string; grantId: string; secret: string } | null {
  const parts = token.split(':');
  if (parts.length !== 3) {
    return null;
  }
  
  const [userId, grantId, secret] = parts;
  
  // Validate that each part is non-empty
  if (!userId || !grantId || !secret) {
    return null;
  }
  
  return { userId, grantId, secret };
}

/**
 * Hash a token for storage
 * Uses SHA-256 to create a one-way hash
 * 
 * @param token - The token to hash
 * @returns Promise resolving to the hex-encoded hash
 */
export async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate CSRF token for forms
 */
export function generateCSRFToken(): string {
  return generateSecureToken();
}

/**
 * Verify CSRF token
 */
export function verifyCSRFToken(token: string | null, expected: string | null): boolean {
  if (!token || !expected) return false;
  
  // Constant-time comparison to prevent timing attacks
  if (token.length !== expected.length) return false;
  
  let result = 0;
  for (let i = 0; i < token.length; i++) {
    result |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  
  return result === 0;
}

/**
 * Validate URL for SSRF protection
 * Blocks access to private IPs, local networks, and cloud metadata endpoints
 * Note: For OAuth, localhost can be in registered redirect URIs, but this
 * function validates against SSRF attacks in general contexts.
 */
export function isSecureRedirectUri(uri: string): boolean {
  try {
    const url = new URL(uri);
    
    // Only allow HTTP(S) protocols
    if (!['http:', 'https:'].includes(url.protocol)) {
      return false;
    }
    
    const hostname = url.hostname.toLowerCase();
    
    // Block localhost variations
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return false;
    }
    
    // Block IPv6 localhost (hostname may include brackets)
    const cleanHostname = hostname.replace(/^\[|\]$/g, '');
    if (cleanHostname === '::1' || cleanHostname === '0:0:0:0:0:0:0:1' || 
        cleanHostname === '0000:0000:0000:0000:0000:0000:0000:0001') {
      return false;
    }
    
    // Block private IPv4 ranges (RFC 1918)
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const ipMatch = hostname.match(ipv4Regex);
    if (ipMatch) {
      const [, ...parts] = ipMatch;
      const [a, b, c, d] = parts.map(Number);
      
      // Validate IP components
      if (a > 255 || b > 255 || c > 255 || d > 255) {
        return false;
      }
      
      // 10.0.0.0/8
      if (a === 10) return false;
      
      // 172.16.0.0/12
      if (a === 172 && b >= 16 && b <= 31) return false;
      
      // 192.168.0.0/16
      if (a === 192 && b === 168) return false;
      
      // 127.0.0.0/8 (loopback)
      if (a === 127) return false;
      
      // 169.254.0.0/16 (link-local)
      if (a === 169 && b === 254) return false;
      
      // 0.0.0.0/8
      if (a === 0) return false;
      
      // Cloud metadata endpoints (already covered by 169.254.0.0/16 check above)
    }
    
    // Block IPv6 private ranges
    if (cleanHostname.includes(':')) {
      // IPv6 localhost (already handled above but be thorough)
      if (cleanHostname.startsWith('::')) return false;
      
      // IPv6 link-local (fe80::/10)
      if (cleanHostname.startsWith('fe80:')) return false;
      
      // IPv6 unique local (fc00::/7)
      if (cleanHostname.startsWith('fc') || cleanHostname.startsWith('fd')) return false;
      
      // IPv6 multicast (ff00::/8)
      if (cleanHostname.startsWith('ff')) return false;
    }
    
    // Block well-known metadata hostnames
    const blockedHostnames = [
      'metadata.google.internal',
      'metadata.goog',
      'metadata',
      'instance-data',
    ];
    
    if (blockedHostnames.includes(hostname)) {
      return false;
    }
    
    // Block .local domains (mDNS)
    if (hostname.endsWith('.local')) {
      return false;
    }
    
    // Block numeric TLDs (but allow valid IP addresses)
    // Valid IPs have already been checked above
    if (!ipMatch && !hostname.includes(':')) {
      // Not an IP, check for numeric TLD
      const parts = hostname.split('.');
      if (parts.length > 1) {
        const tld = parts[parts.length - 1];
        if (tld && !isNaN(Number(tld))) {
          return false;
        }
      }
    }
    
    return true;
  } catch {
    // Invalid URL
    return false;
  }
}