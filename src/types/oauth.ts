/**
 * OAuth Types
 *
 * Types for OAuth authentication flow.
 */

export type DeviceCodeResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
};

export type TokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
};

export type TokenErrorResponse = {
  error: string;
  error_description?: string;
};
