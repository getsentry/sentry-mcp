import whoami from "./whoami";
import findOrganizations from "./find-organizations";
import findTeams from "./find-teams";
import findProjects from "./find-projects";
import findReleases from "./find-releases";
import getReleaseDetails from "./get-release-details";
import findDashboards from "./find-dashboards";
import getDashboardDetails from "./get-dashboard-details";
import findMonitors from "./find-monitors";
import getMonitorDetails from "./get-monitor-details";
import findAlertRules from "./find-alert-rules";
import getAlertRule from "./get-alert-rule";
import getIssueDetails from "./get-issue-details";
import getIssueActivity from "./get-issue-activity";
import getIssueTagValues from "./get-issue-tag-values";
import getTraceDetails from "./get-trace-details";
import getReplayDetails from "./get-replay-details";
import getEventAttachment from "./get-event-attachment";
import updateIssue from "./update-issue";
import searchEvents from "./search-events";
import createTeam from "./create-team";
import createProject from "./create-project";
import updateProject from "./update-project";
import createDsn from "./create-dsn";
import findDsns from "./find-dsns";
import updateDsn from "./update-dsn";
import analyzeIssueWithSeer from "./analyze-issue-with-seer";
import searchDocs from "./search-docs";
import getDoc from "./get-doc";
import searchIssues from "./search-issues";
import searchIssueEvents from "./search-issue-events";
import getProfile from "./get-profile";
import getProfileDetails from "./get-profile-details";
import getSentryResource from "./get-sentry-resource";
import getSnapshot from "./get-snapshot";
import getSnapshotImage from "./get-snapshot-image";
import getLatestBaseSnapshot from "./get-latest-base-snapshot";
import getAIConversationDetails from "./get-ai-conversation-details";
import addIssueNote from "./add-issue-note";
import type { ToolConfig } from "../types";

/**
 * Catalog of ordinary Sentry MCP operations.
 *
 * These tools are searchable/executable through search_sentry_tools and execute_sentry_tool.
 * A central subset is also exposed directly via tools/list in surfaces.ts.
 *
 * Wrapper tools such as search_sentry_tools, execute_sentry_tool, and use_sentry intentionally
 * live outside this catalog.
 */
const catalogTools = {
  whoami,
  find_organizations: findOrganizations,
  find_teams: findTeams,
  find_projects: findProjects,
  find_releases: findReleases,
  get_release_details: getReleaseDetails,
  find_dashboards: findDashboards,
  get_dashboard_details: getDashboardDetails,
  find_monitors: findMonitors,
  get_monitor_details: getMonitorDetails,
  find_alert_rules: findAlertRules,
  get_alert_rule: getAlertRule,
  get_issue_details: getIssueDetails,
  get_issue_activity: getIssueActivity,
  get_issue_tag_values: getIssueTagValues,
  get_trace_details: getTraceDetails,
  get_replay_details: getReplayDetails,
  get_event_attachment: getEventAttachment,
  update_issue: updateIssue,
  search_events: searchEvents,
  create_team: createTeam,
  create_project: createProject,
  update_project: updateProject,
  create_dsn: createDsn,
  find_dsns: findDsns,
  update_dsn: updateDsn,
  analyze_issue_with_seer: analyzeIssueWithSeer,
  search_docs: searchDocs,
  get_doc: getDoc,
  search_issues: searchIssues,
  search_issue_events: searchIssueEvents,
  get_profile: getProfile,
  get_profile_details: getProfileDetails,
  get_sentry_resource: getSentryResource,
  get_snapshot: getSnapshot,
  get_snapshot_image: getSnapshotImage,
  get_latest_base_snapshot: getLatestBaseSnapshot,
  get_ai_conversation_details: getAIConversationDetails,
  add_issue_note: addIssueNote,
} as const satisfies Record<string, ToolConfig<any>>;

export default catalogTools;
export type CatalogToolName = keyof typeof catalogTools;
