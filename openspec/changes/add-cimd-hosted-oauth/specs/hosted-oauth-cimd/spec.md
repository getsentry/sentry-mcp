## ADDED Requirements

### Requirement: Hosted OAuth advertises CIMD support
The hosted Cloudflare OAuth authorization server SHALL advertise OAuth Client ID Metadata Document support when CIMD is enabled.

#### Scenario: Root authorization metadata advertises CIMD
- **WHEN** a client requests `/.well-known/oauth-authorization-server`
- **THEN** the response metadata includes `client_id_metadata_document_supported: true`
- **AND** the response continues to include `registration_endpoint`

#### Scenario: Scoped authorization metadata for base MCP advertises CIMD
- **WHEN** a client requests `/.well-known/oauth-authorization-server/mcp`
- **THEN** the response metadata includes `client_id_metadata_document_supported: true`
- **AND** the `authorization_endpoint` includes an RFC 8707 `resource` parameter for `/mcp`

#### Scenario: Scoped authorization metadata for organization and project advertises CIMD
- **WHEN** a client requests `/.well-known/oauth-authorization-server/mcp/{organizationSlug}/{projectSlug}`
- **THEN** the response metadata includes `client_id_metadata_document_supported: true`
- **AND** the `authorization_endpoint` includes an RFC 8707 `resource` parameter for the same organization and project path

### Requirement: Hosted OAuth accepts valid URL client IDs
The hosted Cloudflare OAuth authorization server SHALL accept an HTTPS URL `client_id` when the referenced client metadata document is valid.

#### Scenario: Valid CIMD authorization request reaches consent
- **WHEN** an authorization request uses `client_id` set to an HTTPS client metadata document URL
- **AND** the fetched metadata document contains a matching `client_id`, at least one matching `redirect_uri`, compatible `grant_types`, compatible `response_types`, and `token_endpoint_auth_method: "none"`
- **THEN** the authorization request reaches the approval dialog
- **AND** the approval dialog uses the fetched client metadata

#### Scenario: Approved CIMD request validates redirect URI
- **WHEN** a user approves a CIMD authorization request
- **THEN** the server validates the selected `redirect_uri` against the fetched client metadata before redirecting upstream
- **AND** the upstream redirect is created only for a registered redirect URI

### Requirement: Hosted OAuth rejects invalid CIMD metadata safely
The hosted Cloudflare OAuth authorization server MUST reject invalid client metadata documents without granting authorization or creating open redirects.

#### Scenario: Metadata fetch fails
- **WHEN** an authorization request uses a URL `client_id` whose metadata fetch does not return a successful response
- **THEN** the authorization request is rejected with an OAuth client error
- **AND** no upstream authorization redirect is produced

#### Scenario: Metadata client ID mismatch
- **WHEN** the fetched metadata document has a `client_id` that does not exactly match the URL `client_id`
- **THEN** the authorization request is rejected with an OAuth client error
- **AND** no upstream authorization redirect is produced

#### Scenario: Metadata has no redirect URI
- **WHEN** the fetched metadata document has no usable `redirect_uris`
- **THEN** the authorization request is rejected with an OAuth client error
- **AND** no upstream authorization redirect is produced

#### Scenario: Requested redirect URI is not listed
- **WHEN** the authorization request uses a `redirect_uri` that is not listed in the fetched metadata document
- **THEN** the authorization request is rejected with an OAuth client error
- **AND** no upstream authorization redirect is produced

#### Scenario: Metadata declares a disallowed client authentication method
- **WHEN** the fetched metadata document declares a confidential-client authentication method such as `client_secret_post`
- **THEN** the authorization request is rejected with an OAuth client error
- **AND** no upstream authorization redirect is produced

### Requirement: Consent UI identifies URL-based clients
The hosted OAuth approval dialog SHALL display enough client and redirect information for users to evaluate URL-based client identities.

#### Scenario: Consent shows fetched client name and client origin
- **WHEN** the approval dialog is rendered for a CIMD client
- **THEN** the dialog displays the fetched client name
- **AND** the dialog displays the URL client ID or a sanitized host/path derived from it

#### Scenario: Consent shows redirect destination
- **WHEN** the approval dialog is rendered with a redirect URI
- **THEN** the dialog displays the redirect URI
- **AND** the dialog displays the redirect URI hostname as the post-approval destination

#### Scenario: Consent keeps localhost redirects visible
- **WHEN** the approval dialog is rendered with a localhost redirect URI
- **THEN** the dialog displays the localhost redirect URI in the redirect destination warning

### Requirement: Demo chat uses a separate CIMD client identity
The hosted demo chat SHALL use a first-party OAuth client identity that is separate from the MCP protected resource identity when running on HTTPS.

#### Scenario: Demo chat metadata describes only the chat client
- **WHEN** a client requests `/.well-known/oauth-client/demo-chat.json`
- **THEN** the response `client_id` equals the metadata URL
- **AND** `client_uri` is the deployment root
- **AND** `redirect_uris` contains `/api/auth/callback`
- **AND** `redirect_uris` does not contain `/mcp`

#### Scenario: Demo chat authorization uses CIMD on HTTPS
- **WHEN** a browser starts demo chat OAuth from an HTTPS origin
- **THEN** the authorization redirect uses the demo chat metadata URL as `client_id`
- **AND** the authorization redirect includes an RFC 8707 `resource` parameter for `/mcp`
- **AND** the chat flow does not perform Dynamic Client Registration

#### Scenario: Demo chat keeps DCR fallback for local HTTP
- **WHEN** a browser starts demo chat OAuth from a local HTTP origin
- **THEN** the chat flow uses Dynamic Client Registration
- **AND** the authorization redirect includes an RFC 8707 `resource` parameter for `/mcp`

#### Scenario: Demo chat token exchange preserves resource scope
- **WHEN** the demo chat exchanges an authorization code for tokens
- **THEN** the token request includes the same `/mcp` resource identifier

### Requirement: Dynamic Client Registration remains available
The hosted Cloudflare OAuth authorization server SHALL preserve Dynamic Client Registration for clients that do not use CIMD.

#### Scenario: DCR endpoint remains advertised
- **WHEN** a client requests authorization-server metadata
- **THEN** the metadata includes `registration_endpoint`
- **AND** DCR-capable clients can continue registering through `/oauth/register`

#### Scenario: Existing DCR authorization continues
- **WHEN** an authorization request uses a previously registered non-URL client ID
- **THEN** the server validates the request against the registered client metadata
- **AND** the request can reach the approval dialog without requiring a client metadata document URL

### Requirement: Scoped MCP resource behavior remains intact
The hosted Cloudflare OAuth server SHALL preserve exact path-scoped MCP resource discovery and challenges while adding CIMD support.

#### Scenario: Protected resource metadata preserves exact resource
- **WHEN** a client requests `/.well-known/oauth-protected-resource/mcp/{organizationSlug}/{projectSlug}` with query parameters
- **THEN** the response `resource` value includes the exact `/mcp/{organizationSlug}/{projectSlug}` path and query
- **AND** the response includes at least one authorization server

#### Scenario: WWW-Authenticate challenge uses scoped protected resource metadata
- **WHEN** an unauthenticated request to `/mcp/{organizationSlug}/{projectSlug}` receives a 401 response
- **THEN** the `WWW-Authenticate` header includes exactly one `resource_metadata` parameter
- **AND** that parameter points to `/.well-known/oauth-protected-resource/mcp/{organizationSlug}/{projectSlug}` with the original query string preserved
