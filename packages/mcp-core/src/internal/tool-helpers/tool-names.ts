import { hasAgentProvider } from "../agents/provider-factory";

export function getEventsToolName(): string {
  return hasAgentProvider() ? "search_events" : "list_events";
}

export function getIssuesToolName(): string {
  return hasAgentProvider() ? "search_issues" : "list_issues";
}
