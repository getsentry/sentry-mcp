# OAuth 2.1 Security Checklist

Security vectors to review when auditing OAuth 2.1 implementations.

## Authorization Endpoint

### Open Redirect / SSRF
- [ ] Redirect URIs must be pre-registered and exactly matched
- [ ] Invalid redirect_uri must not cause redirect (show error page instead)
- [ ] Block private IPs, localhost, cloud metadata endpoints (169.254.169.254)
- [ ] Validate URL scheme (http/https only)
- [ ] No wildcards or pattern matching in redirect URIs

### CSRF
- [ ] State parameter preserved and validated
- [ ] CSRF tokens for authorization forms
- [ ] Single-use tokens with expiration

### Authorization Code
- [ ] Single-use enforcement (prevent replay attacks)
- [ ] Short expiration (max 10 minutes per spec)
- [ ] Bound to client_id and redirect_uri
- [ ] Invalidate on suspicious activity

## Token Endpoint

### Client Authentication
- [ ] Confidential clients must authenticate
- [ ] Constant-time secret comparison
- [ ] No timing attacks on authentication

### Code Exchange
- [ ] Validate code hasn't been used before
- [ ] Delete code atomically after validation
- [ ] Verify client_id matches authorization
- [ ] Verify redirect_uri if provided in authorization
- [ ] PKCE verification for public clients

### Token Generation
- [ ] Cryptographically secure random (min 128 bits entropy)
- [ ] Unpredictable token values
- [ ] Different tokens for each request

## Refresh Tokens

### Rotation
- [ ] Single-use refresh tokens
- [ ] Invalidate old token on rotation
- [ ] Detect and prevent replay attacks
- [ ] Invalidate token family on suspicious use

## General Security

### XSS Prevention
- [ ] HTML escape all user inputs
- [ ] Content-Type headers properly set
- [ ] No inline scripts in consent pages

### Rate Limiting
- [ ] Token endpoint: limit by client_id (10-20 req/min)
- [ ] Authorization endpoint: limit by IP (5-10 req/min)
- [ ] Registration endpoint: strict limits (1-5 req/hour)
- [ ] Failed attempt tracking with progressive delays
- [ ] Bypass prevention (validate before OAuth logic)

### Error Handling
- [ ] No sensitive data in error messages
- [ ] Consistent error responses
- [ ] OAuth 2.1 compliant error codes

### Token Security
- [ ] Appropriate expiration times
- [ ] Secure storage with encryption at rest
- [ ] Token revocation capability
- [ ] Scope validation and enforcement

### Audit & Monitoring
- [ ] Log security events
- [ ] Detect unusual patterns
- [ ] Monitor for token replay
- [ ] Track failed authentication attempts

## OAuth 2.1 Compliance

### Deprecated Flows
- [ ] No implicit grant (response_type=token)
- [ ] No resource owner password credentials
- [ ] PKCE required for public clients

### Required Features
- [ ] Exact redirect URI matching
- [ ] Authorization code expiry <= 10 minutes  
- [ ] Refresh token rotation (recommended)
- [ ] Discovery metadata endpoint

## References
- [OAuth 2.1 Draft](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-10)
- [OAuth Security BCP](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics)
- [OWASP OAuth Security](https://cheatsheetseries.owasp.org/cheatsheets/OAuth2_Cheat_Sheet.html)