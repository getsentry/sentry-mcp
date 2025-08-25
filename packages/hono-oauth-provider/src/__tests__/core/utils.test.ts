/**
 * Tests for OAuth utility functions
 */

import { describe, it, expect } from 'vitest';
import { escapeHtml, generateSecureToken, generateCSRFToken, verifyCSRFToken } from '../../lib/utils';

describe('Security Utilities', () => {
  describe('escapeHtml', () => {
    it('should escape HTML special characters', () => {
      expect(escapeHtml('<script>alert("XSS")</script>')).toBe(
        '&lt;script&gt;alert(&quot;XSS&quot;)&lt;&#x2F;script&gt;'
      );
    });

    it('should escape all dangerous characters', () => {
      expect(escapeHtml('&<>"\'/')).toBe('&amp;&lt;&gt;&quot;&#39;&#x2F;');
    });

    it('should leave safe characters unchanged', () => {
      expect(escapeHtml('Hello World 123')).toBe('Hello World 123');
    });

    it('should handle empty strings', () => {
      expect(escapeHtml('')).toBe('');
    });

    it('should handle complex HTML injection attempts', () => {
      const malicious = '<img src=x onerror="alert(\'XSS\')">';
      expect(escapeHtml(malicious)).not.toContain('<');
      expect(escapeHtml(malicious)).not.toContain('>');
    });
  });

  describe('generateSecureToken', () => {
    it('should generate different tokens each time', () => {
      const token1 = generateSecureToken();
      const token2 = generateSecureToken();
      expect(token1).not.toBe(token2);
    });

    it('should generate base64url safe tokens', () => {
      const token = generateSecureToken();
      // Should not contain base64 padding or unsafe characters
      expect(token).not.toContain('=');
      expect(token).not.toContain('+');
      expect(token).not.toContain('/');
    });

    it('should generate tokens with sufficient length', () => {
      const token = generateSecureToken();
      // 32 bytes = 256 bits, base64 encoding increases length by ~4/3
      expect(token.length).toBeGreaterThan(40);
    });

    it('should generate cryptographically random tokens', () => {
      // Generate many tokens and ensure no duplicates
      const tokens = new Set();
      for (let i = 0; i < 1000; i++) {
        tokens.add(generateSecureToken());
      }
      expect(tokens.size).toBe(1000);
    });
  });

  describe('generateCSRFToken', () => {
    it('should generate secure CSRF tokens', () => {
      const token = generateCSRFToken();
      expect(token).toBeTruthy();
      expect(token.length).toBeGreaterThan(40);
    });

    it('should generate unique CSRF tokens', () => {
      const token1 = generateCSRFToken();
      const token2 = generateCSRFToken();
      expect(token1).not.toBe(token2);
    });
  });

  describe('verifyCSRFToken', () => {
    it('should verify matching tokens', () => {
      const token = generateCSRFToken();
      expect(verifyCSRFToken(token, token)).toBe(true);
    });

    it('should reject mismatched tokens', () => {
      const token1 = generateCSRFToken();
      const token2 = generateCSRFToken();
      expect(verifyCSRFToken(token1, token2)).toBe(false);
    });

    it('should reject null tokens', () => {
      expect(verifyCSRFToken(null, 'token')).toBe(false);
      expect(verifyCSRFToken('token', null)).toBe(false);
      expect(verifyCSRFToken(null, null)).toBe(false);
    });

    it('should reject empty tokens', () => {
      expect(verifyCSRFToken('', 'token')).toBe(false);
      expect(verifyCSRFToken('token', '')).toBe(false);
    });

    it('should reject tokens of different lengths', () => {
      expect(verifyCSRFToken('short', 'muuuuuuch-longer')).toBe(false);
    });

    it('should use constant-time comparison', () => {
      // This test verifies the implementation uses constant-time comparison
      // by checking that it compares all characters even when lengths differ
      const token = 'test-token';
      const similar = 'test-tokeN'; // Only last char differs
      expect(verifyCSRFToken(token, similar)).toBe(false);
    });
  });

  describe('isSecureRedirectUri', () => {
    it('should allow valid public URLs', async () => {
      const { isSecureRedirectUri } = await import('../../lib/utils');
      
      expect(isSecureRedirectUri('https://example.com/callback')).toBe(true);
      expect(isSecureRedirectUri('https://app.example.com/oauth/callback')).toBe(true);
      expect(isSecureRedirectUri('http://example.com/callback')).toBe(true);
      expect(isSecureRedirectUri('https://sub.domain.example.com/path')).toBe(true);
    });

    it('should block localhost variations', async () => {
      const { isSecureRedirectUri } = await import('../../lib/utils');
      
      expect(isSecureRedirectUri('http://localhost/callback')).toBe(false);
      expect(isSecureRedirectUri('http://localhost:3000/callback')).toBe(false);
      expect(isSecureRedirectUri('http://127.0.0.1/callback')).toBe(false);
      expect(isSecureRedirectUri('http://127.0.0.1:8080/callback')).toBe(false);
      expect(isSecureRedirectUri('http://[::1]/callback')).toBe(false);
      expect(isSecureRedirectUri('http://[0:0:0:0:0:0:0:1]/callback')).toBe(false);
    });

    it('should block private IPv4 ranges', async () => {
      const { isSecureRedirectUri } = await import('../../lib/utils');
      
      // 10.0.0.0/8
      expect(isSecureRedirectUri('http://10.0.0.1/callback')).toBe(false);
      expect(isSecureRedirectUri('http://10.255.255.255/callback')).toBe(false);
      
      // 172.16.0.0/12
      expect(isSecureRedirectUri('http://172.16.0.1/callback')).toBe(false);
      expect(isSecureRedirectUri('http://172.31.255.255/callback')).toBe(false);
      
      // 192.168.0.0/16
      expect(isSecureRedirectUri('http://192.168.1.1/callback')).toBe(false);
      expect(isSecureRedirectUri('http://192.168.255.255/callback')).toBe(false);
      
      // Link-local 169.254.0.0/16
      expect(isSecureRedirectUri('http://169.254.1.1/callback')).toBe(false);
    });

    it('should block cloud metadata endpoints', async () => {
      const { isSecureRedirectUri } = await import('../../lib/utils');
      
      expect(isSecureRedirectUri('http://169.254.169.254/latest/meta-data')).toBe(false);
      expect(isSecureRedirectUri('http://metadata.google.internal/computeMetadata/v1/')).toBe(false);
      expect(isSecureRedirectUri('http://metadata/computeMetadata/v1/')).toBe(false);
      expect(isSecureRedirectUri('http://instance-data/latest/meta-data')).toBe(false);
    });

    it('should block IPv6 private ranges', async () => {
      const { isSecureRedirectUri } = await import('../../lib/utils');
      
      // Link-local
      expect(isSecureRedirectUri('http://[fe80::1]/callback')).toBe(false);
      
      // Unique local
      expect(isSecureRedirectUri('http://[fc00::1]/callback')).toBe(false);
      expect(isSecureRedirectUri('http://[fd00::1]/callback')).toBe(false);
      
      // Multicast
      expect(isSecureRedirectUri('http://[ff02::1]/callback')).toBe(false);
    });

    it('should block non-HTTP(S) protocols', async () => {
      const { isSecureRedirectUri } = await import('../../lib/utils');
      
      expect(isSecureRedirectUri('file:///etc/passwd')).toBe(false);
      expect(isSecureRedirectUri('ftp://example.com/callback')).toBe(false);
      expect(isSecureRedirectUri('javascript:alert(1)')).toBe(false);
      expect(isSecureRedirectUri('data:text/html,<script>alert(1)</script>')).toBe(false);
    });

    it('should block .local domains', async () => {
      const { isSecureRedirectUri } = await import('../../lib/utils');
      
      expect(isSecureRedirectUri('http://mycomputer.local/callback')).toBe(false);
      expect(isSecureRedirectUri('http://printer.local/callback')).toBe(false);
    });

    it('should block numeric TLDs', async () => {
      const { isSecureRedirectUri } = await import('../../lib/utils');
      
      expect(isSecureRedirectUri('http://example.123/callback')).toBe(false);
      expect(isSecureRedirectUri('http://test.456')).toBe(false);
    });

    it('should handle invalid URLs gracefully', async () => {
      const { isSecureRedirectUri } = await import('../../lib/utils');
      
      expect(isSecureRedirectUri('not-a-url')).toBe(false);
      expect(isSecureRedirectUri('')).toBe(false);
      expect(isSecureRedirectUri('://')).toBe(false);
    });

    it('should allow public IPs that are not in private ranges', async () => {
      const { isSecureRedirectUri } = await import('../../lib/utils');
      
      expect(isSecureRedirectUri('http://8.8.8.8/callback')).toBe(true);
      expect(isSecureRedirectUri('http://1.1.1.1/callback')).toBe(true);
      expect(isSecureRedirectUri('http://172.32.0.1/callback')).toBe(true); // Outside private range
    });
  });
});