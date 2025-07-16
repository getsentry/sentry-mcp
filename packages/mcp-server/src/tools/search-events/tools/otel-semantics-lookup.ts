import type { SentryApiService } from "../../../api-client";

/**
 * Look up OpenTelemetry semantic conventions and attribute patterns
 */
export async function lookupOtelSemantics(
  query: string,
  dataset: "errors" | "logs" | "spans",
  apiService: SentryApiService,
  organizationSlug: string,
  projectId?: string,
): Promise<string> {
  try {
    const lowerQuery = query.toLowerCase();

    // Check for common semantic queries
    if (
      lowerQuery.includes("agent") ||
      lowerQuery.includes("ai") ||
      lowerQuery.includes("llm")
    ) {
      return "For AI/LLM/agent calls, use has:gen_ai.system or has:gen_ai.request.model. Common gen_ai attributes: gen_ai.system, gen_ai.request.model, gen_ai.operation.name, gen_ai.usage.input_tokens, gen_ai.usage.output_tokens";
    }

    if (
      lowerQuery.includes("tool") &&
      (lowerQuery.includes("mcp") || lowerQuery.includes("call"))
    ) {
      return "For MCP tool calls, use has:mcp.tool.name. Common mcp attributes: mcp.tool.name, mcp.session.id, mcp.request.id, mcp.method.name, mcp.transport";
    }

    if (
      lowerQuery.includes("database") ||
      lowerQuery.includes("db") ||
      lowerQuery.includes("sql")
    ) {
      return "For database queries, use has:db.statement or has:db.system. Common db attributes: db.system, db.statement, db.operation, db.name";
    }

    if (
      lowerQuery.includes("http") ||
      lowerQuery.includes("api") ||
      lowerQuery.includes("request")
    ) {
      return "For HTTP requests, use has:http.method or has:http.url. Common http attributes: http.method, http.status_code, http.url, http.request.method, http.response.status_code";
    }

    if (lowerQuery.includes("rpc") || lowerQuery.includes("grpc")) {
      return "For RPC calls, use has:rpc.system or has:rpc.service. Common rpc attributes: rpc.system, rpc.service, rpc.method, rpc.grpc.status_code";
    }

    if (
      lowerQuery.includes("messaging") ||
      lowerQuery.includes("queue") ||
      lowerQuery.includes("kafka")
    ) {
      return "For messaging systems, use has:messaging.system or has:messaging.destination.name. Common messaging attributes: messaging.system, messaging.operation, messaging.destination.name";
    }

    if (
      lowerQuery.includes("kubernetes") ||
      lowerQuery.includes("k8s") ||
      lowerQuery.includes("pod")
    ) {
      return "For Kubernetes, use has:k8s.namespace.name or has:k8s.pod.name. Common k8s attributes: k8s.namespace.name, k8s.pod.name, k8s.container.name, k8s.node.name";
    }

    // For other queries, try to fetch actual attributes if possible
    if (dataset !== "errors") {
      const itemType = dataset === "logs" ? "logs" : "spans";
      const attributeList = await apiService.listTraceItemAttributes({
        organizationSlug,
        itemType,
        project: projectId,
        statsPeriod: "14d",
      });

      const matchingAttrs = attributeList
        .filter((attr) => attr.key?.toLowerCase().includes(lowerQuery))
        .slice(0, 10);

      if (matchingAttrs.length > 0) {
        return `Found ${matchingAttrs.length} matching attributes: ${matchingAttrs.map((attr) => attr.key).join(", ")}`;
      }
    }

    return "No specific attribute semantics found for this query. Try using namespace patterns like gen_ai.*, mcp.*, db.*, http.*";
  } catch (error) {
    return "Error looking up attribute semantics. Use standard OpenTelemetry conventions.";
  }
}

/**
 * Enhance system prompt with dynamic attribute lookup based on query content
 */
export function enhanceSystemPromptWithSemantics(
  systemPrompt: string,
  naturalLanguageQuery: string,
): string {
  let enhanced = systemPrompt;
  const naturalQueryLower = naturalLanguageQuery.toLowerCase();

  if (
    naturalQueryLower.includes("agent") ||
    naturalQueryLower.includes("ai") ||
    naturalQueryLower.includes("llm")
  ) {
    enhanced +=
      "\n\nIMPORTANT: For AI/LLM/agent calls, use has:gen_ai.system or has:gen_ai.request.model. Common gen_ai attributes: gen_ai.system, gen_ai.request.model, gen_ai.operation.name, gen_ai.usage.input_tokens, gen_ai.usage.output_tokens";
  }

  if (
    naturalQueryLower.includes("tool") &&
    (naturalQueryLower.includes("mcp") || naturalQueryLower.includes("call"))
  ) {
    enhanced +=
      "\n\nIMPORTANT: For MCP tool calls, use has:mcp.tool.name. Common mcp attributes: mcp.tool.name, mcp.session.id, mcp.request.id, mcp.method.name, mcp.transport";
  }

  if (
    naturalQueryLower.includes("database") ||
    naturalQueryLower.includes("db") ||
    naturalQueryLower.includes("sql")
  ) {
    enhanced +=
      "\n\nIMPORTANT: For database queries, use has:db.statement or has:db.system. Common db attributes: db.system, db.statement, db.operation, db.name";
  }

  if (
    naturalQueryLower.includes("http") ||
    naturalQueryLower.includes("api") ||
    naturalQueryLower.includes("request")
  ) {
    enhanced +=
      "\n\nIMPORTANT: For HTTP requests, use has:http.method or has:http.url. Common http attributes: http.method, http.status_code, http.url, http.request.method, http.response.status_code";
  }

  if (naturalQueryLower.includes("rpc") || naturalQueryLower.includes("grpc")) {
    enhanced +=
      "\n\nIMPORTANT: For RPC calls, use has:rpc.system or has:rpc.service. Common rpc attributes: rpc.system, rpc.service, rpc.method, rpc.grpc.status_code";
  }

  if (
    naturalQueryLower.includes("messaging") ||
    naturalQueryLower.includes("queue") ||
    naturalQueryLower.includes("kafka")
  ) {
    enhanced +=
      "\n\nIMPORTANT: For messaging systems, use has:messaging.system or has:messaging.destination.name. Common messaging attributes: messaging.system, messaging.operation, messaging.destination.name";
  }

  if (
    naturalQueryLower.includes("kubernetes") ||
    naturalQueryLower.includes("k8s") ||
    naturalQueryLower.includes("pod")
  ) {
    enhanced +=
      "\n\nIMPORTANT: For Kubernetes, use has:k8s.namespace.name or has:k8s.pod.name. Common k8s attributes: k8s.namespace.name, k8s.pod.name, k8s.container.name, k8s.node.name";
  }

  return enhanced;
}
