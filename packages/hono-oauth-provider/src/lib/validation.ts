/**
 * Input validation utilities for OAuth 2.1 provider
 * Implements security best practices for client registration
 * 
 * @see https://datatracker.ietf.org/doc/html/rfc7591#section-2 - Client Registration Request
 * @see https://datatracker.ietf.org/doc/html/rfc6749#section-3.1.2 - Redirect URI Validation
 * @see https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics#section-4.3 - Redirect URI Security
 * @see https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html - OWASP Input Validation
 */

import { z } from 'zod';

/**
 * Maximum number of redirect URIs per client
 */
const MAX_REDIRECT_URIS = 10;

/**
 * Maximum length for client name
 */
const MAX_CLIENT_NAME_LENGTH = 100;

/**
 * Validate and sanitize a redirect URI
 * 
 * @see https://datatracker.ietf.org/doc/html/rfc6749#section-3.1.2.2 - Invalid Endpoint
 * @see https://datatracker.ietf.org/doc/html/rfc8252#section-7 - OAuth for Native Apps
 * @see https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics#section-4.3.1 - Redirect URI Validation
 * 
 * @param uri - The redirect URI to validate
 * @returns Sanitized URI or null if invalid
 */
export function validateRedirectUri(uri: string): string | null {
  try {
    const url = new URL(uri);
    
    // Must be absolute URI per RFC 6749 Section 3.1.2
    // @see https://datatracker.ietf.org/doc/html/rfc6749#section-3.1.2
    if (!url.protocol || !url.hostname) {
      return null;
    }
    
    // Only allow http/https (no javascript:, data:, file:, etc.)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    
    // No fragments allowed in redirect URIs per RFC 6749 Section 3.1.2
    // @see https://datatracker.ietf.org/doc/html/rfc6749#section-3.1.2
    if (url.hash) {
      return null;
    }
    
    // No wildcards allowed (security best practice)
    if (url.hostname.includes('*')) {
      return null;
    }
    
    // Production check: No localhost/private IPs
    // (In development, these might be allowed)
    if (process.env.NODE_ENV === 'production') {
      if (isPrivateIP(url.hostname)) {
        return null;
      }
    }
    
    // No path traversal attempts
    if (url.pathname.includes('../') || url.pathname.includes('..\\')) {
      return null;
    }
    
    // Return the normalized URI
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Check if a hostname is a private IP or localhost
 */
function isPrivateIP(hostname: string): boolean {
  // Localhost variations
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') {
    return true;
  }
  
  // IPv4 private ranges
  const ipv4Pattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = hostname.match(ipv4Pattern);
  if (match) {
    const [, a, b, c, d] = match.map(Number);
    
    // 10.0.0.0/8
    if (a === 10) return true;
    
    // 172.16.0.0/12
    if (a === 172 && b >= 16 && b <= 31) return true;
    
    // 192.168.0.0/16
    if (a === 192 && b === 168) return true;
    
    // 169.254.0.0/16 (link-local)
    if (a === 169 && b === 254) return true;
  }
  
  // .local domains
  if (hostname.endsWith('.local')) {
    return true;
  }
  
  return false;
}

/**
 * Client registration validation schema
 * @see https://datatracker.ietf.org/doc/html/rfc7591#section-2 - Client Metadata
 * @see https://datatracker.ietf.org/doc/html/rfc7591#section-3.2.1 - Registration Request
 */
export const ClientRegistrationSchema = z.object({
  client_name: z.string()
    .min(1, 'Client name is required')
    .max(MAX_CLIENT_NAME_LENGTH, `Client name must be <= ${MAX_CLIENT_NAME_LENGTH} characters`)
    .regex(/^[\w\s\-\.]+$/, 'Client name contains invalid characters'),
  
  redirect_uris: z.array(z.string())
    .min(1, 'At least one redirect URI is required')
    .max(MAX_REDIRECT_URIS, `Maximum ${MAX_REDIRECT_URIS} redirect URIs allowed`)
    .refine(
      (uris) => new Set(uris).size === uris.length,
      'Duplicate redirect URIs are not allowed'
    ),
  
  token_endpoint_auth_method: z.enum(['client_secret_basic', 'client_secret_post', 'none'])
    .optional()
    .default('client_secret_post'),
  
  grant_types: z.array(z.enum(['authorization_code', 'refresh_token']))
    .optional()
    .default(['authorization_code', 'refresh_token']),
  
  response_types: z.array(z.enum(['code']))
    .optional()
    .default(['code']),
  
  scope: z.string()
    .regex(/^[\w\s]*$/, 'Invalid scope format')
    .optional(),
  
  contacts: z.array(z.string().email())
    .optional(),
  
  logo_uri: z.string().url()
    .optional()
    .refine(
      (uri) => !uri || (uri.startsWith('https://') && !isPrivateIP(new URL(uri).hostname)),
      'Logo URI must use HTTPS and be publicly accessible'
    ),
  
  client_uri: z.string().url()
    .optional()
    .refine(
      (uri) => !uri || (uri.startsWith('https://') && !isPrivateIP(new URL(uri).hostname)),
      'Client URI must use HTTPS and be publicly accessible'
    ),
  
  policy_uri: z.string().url()
    .optional()
    .refine(
      (uri) => !uri || (uri.startsWith('https://') && !isPrivateIP(new URL(uri).hostname)),
      'Policy URI must use HTTPS and be publicly accessible'
    ),
  
  tos_uri: z.string().url()
    .optional()
    .refine(
      (uri) => !uri || (uri.startsWith('https://') && !isPrivateIP(new URL(uri).hostname)),
      'Terms of Service URI must use HTTPS and be publicly accessible'
    ),
});

/**
 * Sanitize client metadata for storage and display
 */
export function sanitizeClientMetadata(metadata: z.infer<typeof ClientRegistrationSchema>) {
  return {
    ...metadata,
    // HTML escape display strings
    client_name: escapeHtml(metadata.client_name),
    // Keep redirect URIs as-is - validation happens in the handler
    redirect_uris: metadata.redirect_uris,
  };
}

/**
 * HTML escape function to prevent XSS
 * @see https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html - XSS Prevention
 */
function escapeHtml(str: string): string {
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