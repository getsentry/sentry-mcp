import whoami from "./whoami";
import findOrganizations from "./find-organizations";
import findTeams from "./find-teams";
import findProjects from "./find-projects";
import findReleases from "./find-releases";
import getIssueDetails from "./get-issue-details";
import getIssueTagValues from "./get-issue-tag-values";
import getTraceDetails from "./get-trace-details";
import getEventAttachment from "./get-event-attachment";
import updateIssue from "./update-issue";
import searchEvents from "./search-events";
import createTeam from "./create-team";
import createProject from "./create-project";
import updateProject from "./update-project";
import createDsn from "./create-dsn";
import findDsns from "./find-dsns";
import analyzeIssueWithSeer from "./analyze-issue-with-seer";
import searchDocs from "./search-docs";
import getDoc from "./get-doc";
import searchIssues from "./search-issues";
import searchIssueEvents from "./search-issue-events";
import useSentry from "./use-sentry";
import listIssues from "./list-issues";
import listEvents from "./list-events";
import listIssueEvents from "./list-issue-events";
import getProfile from "./get-profile";
import getSentryResource from "./get-sentry-resource";

/**
 * Tools that require an embedded agent provider (LLM-powered).
 * These are excluded when no agent provider is configured.
 * Note: use_sentry is handled separately via agentMode.
 */
export const AGENT_DEPENDENT_TOOLS = [
  "search_events",
  "search_issues",
  "search_issue_events",
] as const;

/**
 * Simple tools that replace agent-dependent tools when no provider is available.
 * These are excluded when an agent provider IS configured.
 */
export const SIMPLE_REPLACEMENT_TOOLS = [
  "list_issues",
  "list_events",
  "list_issue_events",
] as const;

// Default export: object mapping tool names to tools
export default {
  whoami,
  find_organizations: findOrganizations,
  find_teams: findTeams,
  find_projects: findProjects,
  find_releases: findReleases,
  get_issue_details: getIssueDetails,
  get_issue_tag_values: getIssueTagValues,
  get_trace_details: getTraceDetails,
  get_event_attachment: getEventAttachment,
  update_issue: updateIssue,
  search_events: searchEvents,
  create_team: createTeam,
  create_project: createProject,
  update_project: updateProject,
  create_dsn: createDsn,
  find_dsns: findDsns,
  analyze_issue_with_seer: analyzeIssueWithSeer,
  search_docs: searchDocs,
  get_doc: getDoc,
  search_issues: searchIssues,
  search_issue_events: searchIssueEvents,
  use_sentry: useSentry,
  list_issues: listIssues,
  list_events: listEvents,
  list_issue_events: listIssueEvents,
  get_profile: getProfile,
  get_sentry_resource: getSentryResource,
} as const;

// Type export
export type ToolName = keyof typeof import("./index").default;
