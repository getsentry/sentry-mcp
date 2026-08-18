## ADDED Requirements

### Requirement: Replay events are classified by their payload discriminator
The system SHALL classify replay recording events using the event's
`payload.category` for breadcrumb events and `op` for performance span events,
matching Sentry's upstream replay event taxonomy.

#### Scenario: Breadcrumb click event
- **WHEN** an event has `data.tag` of `breadcrumb` and `payload.category` of `ui.click`
- **THEN** it is classified as a click and rendered with its target, not under a literal `breadcrumb` label

#### Scenario: Breadcrumb console error
- **WHEN** an event has `data.tag` of `breadcrumb` and `payload.category` of `console`
- **THEN** it is classified as a console signal and its level and message are rendered

#### Scenario: Performance span network request
- **WHEN** an event has `data.tag` of `performanceSpan` and `op` of `resource.fetch` or `resource.xhr`
- **THEN** it is classified as a network signal and its method and status code are rendered

#### Scenario: Session noise
- **WHEN** an event is an options, memory, mutations, canvas, script resource, or image resource event
- **THEN** it is excluded from rendered activity

#### Scenario: Successful network request
- **WHEN** a network event has a 2xx status code
- **THEN** it is excluded from rendered signals but still included in kind counts, so a count of `network 58 (2 failed)` describes 58 requests of which 2 are rendered

#### Scenario: Web navigation preference
- **WHEN** a web replay contains both a `navigation` breadcrumb and a `navigation.*` performance span for the same transition
- **THEN** the navigation span is used and the breadcrumb is excluded, matching upstream's web-replay preference

#### Scenario: Unclassifiable event
- **WHEN** an event matches no known category or span `op`
- **THEN** it is excluded from rendered activity and its timestamp is interpreted as milliseconds

### Requirement: Dead and rage clicks are classified behaviorally
The system SHALL distinguish slow, dead, and rage clicks using the slow-click
payload rather than treating every `ui.slowClickDetected` event alike.

#### Scenario: Dead click
- **WHEN** a `ui.slowClickDetected` event has `endReason` of `timeout`, a target tag of `a`, `button`, or `input`, and `timeAfterClickMs` of at least 7000
- **THEN** it is classified as a dead click

#### Scenario: Rage click
- **WHEN** an event meets the dead click conditions and has `clickCount` of at least 5
- **THEN** it is classified as a rage click

#### Scenario: Slow click below threshold
- **WHEN** a `ui.slowClickDetected` event does not meet the dead click conditions
- **THEN** it is classified as a plain slow click and not counted as dead or rage

### Requirement: Replay event timestamps use per-type units
The system SHALL resolve a replay event's timestamp unit from its event type
rather than inferring the unit from the value's magnitude.

#### Scenario: Span-derived event
- **WHEN** the event is a navigation span, resource span, web vital, blur, or focus event
- **THEN** its outer timestamp is interpreted as seconds

#### Scenario: Breadcrumb-derived event
- **WHEN** the event is a click, console, or navigation breadcrumb event
- **THEN** its outer timestamp is interpreted as milliseconds

#### Scenario: Session time origin
- **WHEN** a signal's relative offset is computed
- **THEN** it is measured from the replay's `started_at`, not from the first recorded activity event, so offsets align with the replay metadata timeline

### Requirement: Replay details returns a session map
The `get_replay_details` tool SHALL return the shape of a session rather than a
fixed-length sample of its events.

#### Scenario: Map contents
- **WHEN** `get_replay_details` succeeds for a replay with recording segments
- **THEN** the response includes the total signal count, the covered time span, the page flow, and a per-kind breakdown with error and rage or dead click counts

#### Scenario: Suggested follow-up window
- **WHEN** the replay has at least one associated error with a resolvable timestamp
- **THEN** the response includes a `get_replay_activity` call with a time window bracketing that error

#### Scenario: Error timestamps unavailable
- **WHEN** the error-event lookup fails, is unauthorized, or returns no usable timestamp
- **THEN** the response omits the suggested window, suggests a whole-session digest instead, and still returns the map

#### Scenario: Archived replay
- **WHEN** the replay is archived
- **THEN** the response states that the recording is unavailable and omits the map

### Requirement: Replay activity supports windowed, graded retrieval
The system SHALL provide a `get_replay_activity` catalog tool that returns
replay signals for a requested time window at a requested grain.

#### Scenario: Windowed request
- **WHEN** a caller supplies `startMs` and `endMs`
- **THEN** only signals within that window are returned, measured from the replay's `started_at`

#### Scenario: Whole session request
- **WHEN** a caller omits `startMs` and `endMs`
- **THEN** signals from the entire session are considered

#### Scenario: Digest grain
- **WHEN** a caller requests `grain` of `digest`
- **THEN** the response returns one rollup line per kind with counts, including error counts

#### Scenario: Detail grain
- **WHEN** a caller requests `grain` of `detail`
- **THEN** the response includes available payload for each signal, such as request method, status code, duration, and stack frames

#### Scenario: Kind filtering
- **WHEN** a caller supplies `kinds`
- **THEN** only those kinds are returned and all others are excluded

#### Scenario: Available kinds
- **WHEN** a caller inspects the `kinds` allow-list
- **THEN** it offers `navigation`, `click`, `dead-click`, `rage-click`, `slow-click`, `network`, `console`, `hydration-error`, `feedback`, `web-vital`, and the mobile kinds `tap`, `scroll`, `swipe`, `app-lifecycle`, and `device`, each mapping to one or more upstream event types

#### Scenario: Tool availability
- **WHEN** the MCP server registers tools
- **THEN** `get_replay_activity` is catalog-only, requires the `inspect` skill, and requires the `replays` project capability

### Requirement: Replay DOM structure is readable at a point in time
The system SHALL provide a `get_replay_dom` catalog tool that reconstructs the
page structure of a replay at one moment from the recording's rrweb snapshot and
mutation events, and returns it as an indented tree.

#### Scenario: Point-in-time reconstruction
- **WHEN** a caller supplies `atMs`
- **THEN** the tree reflects the last full snapshot at or before that moment with every intervening mutation applied, and excludes structure that arrives after it

#### Scenario: Required moment
- **WHEN** a caller omits `atMs`
- **THEN** the request is rejected, because defaulting to either end of the session would answer a different question

#### Scenario: Input values supersede shipped attributes
- **WHEN** a form control's value is changed by an rrweb input event rather than an attribute mutation
- **THEN** the tree renders the changed value, not the value the page shipped with

#### Scenario: Later snapshot supersedes earlier state
- **WHEN** a recording contains more than one full snapshot at or before the requested moment
- **THEN** the newest one replaces prior state wholesale rather than being merged into it

#### Scenario: Subtree rooting
- **WHEN** a caller supplies `rootNodeId`
- **THEN** only that node and its descendants are rendered

#### Scenario: Rooting at a node that does not exist yet
- **WHEN** `rootNodeId` names a node absent from the DOM at the requested moment
- **THEN** the response says the node does not exist, rather than returning an empty tree

#### Scenario: Interactive lens
- **WHEN** a caller requests the default `interactive` lens
- **THEN** elements a user can act on are kept along with the ancestors that place them, and inert leaves are dropped

#### Scenario: Budget refusal
- **WHEN** the segment budget is exhausted before the requested moment is reached
- **THEN** the tool refuses and explains what would help, and does not return a partial tree

#### Scenario: Fidelity reporting
- **WHEN** a reconstruction drops operations, or the recording ends before the requested moment
- **THEN** the response states it, so a partial reconstruction is not read as a complete one

#### Scenario: Structural scope
- **WHEN** text or form values were masked by the SDK before upload
- **THEN** they render as delivered and are not labeled redacted, since client-side masking leaves no marker

#### Scenario: Node id handoff
- **WHEN** a caller reads replay activity at `detail` grain
- **THEN** each click signal reports the rrweb node id that `get_replay_dom` accepts as `rootNodeId`

#### Scenario: Tool availability
- **WHEN** the MCP server registers tools
- **THEN** `get_replay_dom` is catalog-only, requires the `inspect` skill, and requires the `replays` project capability

### Requirement: Unavailable replay payload is labeled
The system SHALL distinguish payload that was never captured from payload that
was removed by masking.

#### Scenario: Body not captured
- **WHEN** a network signal is rendered at detail grain and the SDK did not capture bodies
- **THEN** the response marks the body as not captured

#### Scenario: Scrubbed value
- **WHEN** a value equals Relay's PII substitution marker `[Filtered]`
- **THEN** the response marks the value as redacted

#### Scenario: Client-masked value
- **WHEN** a value was masked client-side by the SDK, leaving no distinguishing marker
- **THEN** the value is rendered as delivered and is not claimed to be redacted, because client-side masking is not detectable from the payload

### Requirement: Replay truncation is reported
The system SHALL state when replay output omits available data and how to
retrieve the remainder.

#### Scenario: Signal limit reached
- **WHEN** more signals match a request than the response returns
- **THEN** the response states that results were truncated and includes a cursor for continuation

#### Scenario: Segment paging
- **WHEN** a replay has more recording segments than one page
- **THEN** the system follows the `Link` response header's `cursor` to read subsequent pages rather than silently reading only the first 100 segments

#### Scenario: Segment budget reached
- **WHEN** a replay has more segments than the configured download budget
- **THEN** the response states that the recording was read only up to that budget and that later signals are missing

#### Scenario: Related resource limits
- **WHEN** related issues or traces exceed the display limit
- **THEN** the response states how many were omitted

### Requirement: Replay summary chapters are optional
The system SHALL treat Sentry's experimental replay summary as an additive
enhancement that never degrades replay details.

#### Scenario: Summary available
- **WHEN** the summary endpoint returns `status` of `completed` with a `data` body
- **THEN** `get_replay_details` includes a chapters section rendering each `time_ranges` entry's `period_title` with its `period_start` and `period_end` as relative offsets

#### Scenario: Summary still running
- **WHEN** the summary endpoint returns `status` of `processing` or `not_started`
- **THEN** `get_replay_details` omits the chapters section and returns the map unchanged

#### Scenario: Single read
- **WHEN** `get_replay_details` checks for a replay summary
- **THEN** it issues exactly one read, does not request that a summary be started, and does not retry or wait for a running task to finish

#### Scenario: Summary unavailable
- **WHEN** the summary endpoint returns a permission error, an error status, times out, or returns a body that fails to parse
- **THEN** `get_replay_details` omits the chapters section and returns the map unchanged

### Requirement: Replay search availability matches replay details
The system SHALL apply the `replays` project capability consistently across
replay retrieval paths.

#### Scenario: Project without replays enabled
- **WHEN** a session is constrained to a project that does not have replays enabled
- **THEN** a `search_events` call with `dataset="replays"` is rejected at handler time, consistent with `get_replay_details` being unavailable

#### Scenario: Dataset not advertised
- **WHEN** a session is constrained to a project that does not have replays enabled
- **THEN** the `search_events` tool description and dataset options omit `replays`, so the routing agent does not select a dataset that would be rejected

### Requirement: Replay sort options match what Sentry can sort
The system SHALL accept exactly the replay sort values Sentry's replay sort
configuration supports, and SHALL NOT advertise unsortable fields as sortable.

#### Scenario: Sortable field accepted
- **WHEN** an agent sorts by a replay field present in Sentry's replay sort configuration
- **THEN** the request is accepted rather than rejected as an invalid sort

#### Scenario: Filterable but unsortable field
- **WHEN** a replay field is searchable but absent from Sentry's replay sort configuration
- **THEN** field discovery does not present it as a sort option, so an agent cannot pick a sort that Sentry would reject

### Requirement: Replay lookup failures are distinguishable from absence
The system SHALL not report an unavailable replay signal as an absent one.

#### Scenario: Replay count rate limited
- **WHEN** the replay count lookup for an issue is rate limited or otherwise fails
- **THEN** the issue response indicates that replay information was unavailable rather than implying the issue has no replays
