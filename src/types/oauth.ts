/**
 * OAuth Types
 *
 * Types and Zod schemas for OAuth authentication flow (RFC 8628).
 */

import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Device Code Response (Step 1 of Device Flow)
// ─────────────────────────────────────────────────────────────────────────────

export const DeviceCodeResponseSchema = z
  .object({
    device_code: z.string(),
    user_code: z.string(),
    verification_uri: z.string(),
    verification_uri_complete: z.string().optional(),
    expires_in: z.number(),
    interval: z.number(),
  })
  .passthrough();

export type DeviceCodeResponse = z.infer<typeof DeviceCodeResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Token Response (Successful authorization)
// ─────────────────────────────────────────────────────────────────────────────

export const TokenResponseSchema = z
  .object({
    access_token: z.string(),
    token_type: z.string(),
    expires_in: z.number(),
    expires_at: z.string().optional(),
    refresh_token: z.string().optional(),
    scope: z.string().optional(),
    user: z
      .object({
        id: z.string(),
        name: z.string(),
        email: z.string(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type TokenResponse = z.infer<typeof TokenResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Token Error Response (OAuth error during polling)
// ─────────────────────────────────────────────────────────────────────────────

export const TokenErrorResponseSchema = z
  .object({
    error: z.string(),
    error_description: z.string().optional(),
  })
  .passthrough();

export type TokenErrorResponse = z.infer<typeof TokenErrorResponseSchema>;
