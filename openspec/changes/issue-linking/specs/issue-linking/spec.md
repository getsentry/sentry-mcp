## ADDED Requirements

### Requirement: Link Existing External Issues
The `update_issue` tool SHALL allow linking an existing external issue to a Sentry issue when `externalIssueUrl` is provided.

#### Scenario: Link-only request succeeds
- **WHEN** `update_issue` is called with a valid Sentry issue and `externalIssueUrl`, without `status` or `assignedTo`
- **THEN** the tool links the external issue and returns a response that includes the linked issue identifier and URL

#### Scenario: Combined update and link succeeds
- **WHEN** `update_issue` is called with both issue update parameters and `externalIssueUrl`
- **THEN** the tool updates the Sentry issue, links the external issue, and reports both changes in the response

#### Scenario: Creation parameters are not accepted for linking
- **WHEN** `update_issue` is called with link parameters
- **THEN** the tool treats `externalIssueUrl` as an existing issue link target and does not create a new external ticket

### Requirement: Native Integration Linking
The `update_issue` tool SHALL link native Sentry issue-tracking integrations through Sentry's group integration link endpoint.

#### Scenario: Native integration resolved by URL
- **WHEN** `externalIssueUrl` has a recognized native provider URL shape and maps unambiguously to one issue-capable native integration
- **THEN** the tool uses that integration for the link request

#### Scenario: Native integration resolution is ambiguous
- **WHEN** provider or URL inference matches multiple native integrations
- **THEN** the tool raises a user input error listing the candidate integration names and providers

### Requirement: Native Provider URL Parsing
The `update_issue` tool SHALL parse canonical external issue URLs for supported native providers into Sentry's internal native integration link payload.

#### Scenario: Jira URL is parsed
- **WHEN** `externalIssueUrl` is a Jira or Jira Server issue URL containing `/browse/PROJ-123`
- **THEN** the tool sends `externalIssue=PROJ-123` to the native integration link endpoint

#### Scenario: GitHub URL is parsed
- **WHEN** `externalIssueUrl` is a GitHub or GitHub Enterprise issue URL containing `owner/repo/issues/123`
- **THEN** the tool sends `repo=owner/repo` and `externalIssue=123` to the native integration link endpoint

#### Scenario: GitLab URL is parsed
- **WHEN** `externalIssueUrl` is a GitLab issue URL containing `group/project/-/issues/123`
- **THEN** the tool sends the GitLab project and issue identifier in the format expected by Sentry's GitLab integration

#### Scenario: Bitbucket URL is parsed
- **WHEN** `externalIssueUrl` is a Bitbucket issue URL containing `workspace/repo/issues/123`
- **THEN** the tool sends `repo=workspace/repo` and `externalIssue=123` to the native integration link endpoint

#### Scenario: Azure DevOps URL is parsed
- **WHEN** `externalIssueUrl` is an Azure DevOps or VSTS work item URL containing `/_workitems/edit/123`
- **THEN** the tool sends `externalIssue=123` to the native integration link endpoint

### Requirement: Native Link Config Validation
The `update_issue` tool SHALL use Sentry's native integration link configuration to validate internally constructed link payloads.

#### Scenario: Parsed fields satisfy link config
- **WHEN** Sentry's link config required fields are satisfied by the parsed URL and config defaults
- **THEN** the tool sends the constructed payload to the native integration link endpoint

#### Scenario: Required fields are missing
- **WHEN** Sentry's link config requires fields that cannot be derived from the URL or config defaults
- **THEN** the tool raises a user input error explaining that the URL shape is unsupported for that provider

### Requirement: Sentry App External Issue Linking
The `update_issue` tool SHALL support platform external issue links through installed Sentry Apps without exposing installation UUIDs as user-facing inputs.

#### Scenario: Sentry App link succeeds
- **WHEN** `externalIssueUrl` targets an installed Sentry App provider and the URL contains an inferable identifier
- **THEN** the tool resolves the Sentry App installation internally and creates the external issue link

#### Scenario: Linear URL is parsed
- **WHEN** `externalIssueUrl` is a Linear issue URL containing `/issue/ENG-123`
- **THEN** the tool creates a Sentry App platform external issue with `webUrl` set to the URL, `identifier=ENG-123`, and `project=ENG`

#### Scenario: Shortcut URL is parsed
- **WHEN** `externalIssueUrl` is a Shortcut story URL containing `/story/123`
- **THEN** the tool creates a Sentry App platform external issue with `webUrl` set to the URL, an identifier derived from the story id, and a stable project value

#### Scenario: Sentry App resolution is ambiguous
- **WHEN** the request matches multiple Sentry App installations
- **THEN** the tool raises a user input error listing candidate app names and slugs without listing installation UUIDs

### Requirement: Link Validation Before Mutation
The `update_issue` tool SHALL validate external link target resolution and required link payload fields before applying Sentry issue status, ignore, or assignment changes.

#### Scenario: Link validation fails before issue update
- **WHEN** a combined update-and-link request has an invalid, unsupported, or ambiguous `externalIssueUrl`
- **THEN** the tool raises a user input error and does not call the Sentry issue update endpoint

#### Scenario: No action provided
- **WHEN** `update_issue` is called without status, assignment, ignore, reason-only no-op, or `externalIssueUrl`
- **THEN** the tool raises a user input error explaining the accepted actions

### Requirement: Partial Success Reporting
The `update_issue` tool SHALL clearly report partial success when an issue update succeeds but external issue linking fails afterward.

#### Scenario: Link write fails after issue update
- **WHEN** a combined update-and-link request successfully updates the Sentry issue but the external link write fails
- **THEN** the tool response states that the issue update succeeded and the external link failed, including the link failure message

### Requirement: Existing Link Visibility
The `update_issue` tool SHALL report linked external issue changes consistently with existing issue detail external link formatting.

#### Scenario: Link result has display fields
- **WHEN** the external link API returns display name, provider/service type, and URL
- **THEN** the response includes those fields in the changes made section

#### Scenario: Link result lacks display fields
- **WHEN** the external link API omits optional display fields
- **THEN** the response falls back to the requested external issue identifier and URL

### Requirement: Future External Issue Creation Compatibility
The issue-linking implementation SHALL keep provider resolution and payload construction separate from the public link input schema so future external issue creation can reuse provider discovery without changing link behavior.

#### Scenario: Link API remains URL-based
- **WHEN** future ticket creation support is added
- **THEN** existing link calls using `externalIssueUrl` continue to link existing external issues without requiring creation-specific parameters

#### Scenario: Provider resolution is reusable
- **WHEN** future ticket creation support needs to choose a native integration or Sentry App installation
- **THEN** it can reuse the provider/app discovery helpers introduced for issue linking without depending on link-only URL payload construction
