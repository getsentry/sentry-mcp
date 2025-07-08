import whoami from "./whoami";
import findOrganizations from "./find-organizations";
import findTeams from "./find-teams";
import findProjects from "./find-projects";
import findIssues from "./find-issues";
import findReleases from "./find-releases";
import findTags from "./find-tags";
import getIssueDetails from "./get-issue-details";
import getEventAttachment from "./get-event-attachment";
import updateIssue from "./update-issue";
import findErrors from "./find-errors";
import findTransactions from "./find-transactions";
import createTeam from "./create-team";
import createProject from "./create-project";
import updateProject from "./update-project";
import createDsn from "./create-dsn";
import findDsns from "./find-dsns";
import analyzeIssueWithSeer from "./analyze-issue-with-seer";
import searchDocs from "./search-docs";
import getDoc from "./get-doc";

// Default export: object mapping tool names to tools
export default {
  whoami,
  find_organizations: findOrganizations,
  find_teams: findTeams,
  find_projects: findProjects,
  find_issues: findIssues,
  find_releases: findReleases,
  find_tags: findTags,
  get_issue_details: getIssueDetails,
  get_event_attachment: getEventAttachment,
  update_issue: updateIssue,
  find_errors: findErrors,
  find_transactions: findTransactions,
  create_team: createTeam,
  create_project: createProject,
  update_project: updateProject,
  create_dsn: createDsn,
  find_dsns: findDsns,
  analyze_issue_with_seer: analyzeIssueWithSeer,
  search_docs: searchDocs,
  get_doc: getDoc,
} as const;

// Type export
export type ToolName = keyof typeof import("./index").default;
