/**
 * HTTP client for fetching Sentry SDK-specific instrumentation guidelines.
 *
 * Fetches SDK-specific context and configuration guidelines from structured
 * endpoints to provide up-to-date instrumentation instructions. Handles
 * caching, fallbacks, and multiple endpoint formats.
 */
import { z } from "zod";

/**
 * Schema for SDK context response
 */
export const SdkContextSchema = z.object({
  sdk: z.string(),
  version: z.string(),
  content: z.string(),
  fetchedAt: z.string(),
  source: z.string(),
});

export type SdkContext = z.infer<typeof SdkContextSchema>;

/**
 * Schema for SDK context fetch configuration
 */
export const SdkContextConfigSchema = z.object({
  sdk: z.string(),
  version: z.string().optional(),
  baseUrl: z.string().optional(),
  timeout: z.number().optional(),
  fallbackToBuiltIn: z.boolean().optional(),
});

export type SdkContextConfig = z.infer<typeof SdkContextConfigSchema>;

/**
 * Built-in SDK knowledge for fallback scenarios
 */
export const BUILT_IN_SDK_CONTEXT = {
  "javascript.react": {
    content: `# Sentry React SDK Instrumentation

## Installation

\`\`\`bash
npm install @sentry/react
\`\`\`

## Basic Setup

\`\`\`javascript
import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: "YOUR_DSN_HERE",
  environment: process.env.NODE_ENV,
  tracesSampleRate: 1.0,
  integrations: [
    Sentry.browserTracingIntegration(),
  ],
});
\`\`\`

## Error Boundaries

\`\`\`javascript
import { ErrorBoundary } from "@sentry/react";

function App() {
  return (
    <ErrorBoundary fallback={ErrorFallback} showDialog>
      <MyApp />
    </ErrorBoundary>
  );
}
\`\`\`

## Performance Monitoring

Sentry will automatically instrument React components and routing when configured properly.`,
  },
  "python.django": {
    content: `# Sentry Django SDK Instrumentation

## Installation

\`\`\`bash
pip install sentry-sdk[django]
\`\`\`

## Settings Configuration

\`\`\`python
import sentry_sdk
from sentry_sdk.integrations.django import DjangoIntegration

sentry_sdk.init(
    dsn="YOUR_DSN_HERE",
    integrations=[DjangoIntegration(transaction_style='url')],
    traces_sample_rate=1.0,
    send_default_pii=True,
)
\`\`\`

## Environment Setup

Add to your Django settings.py:

\`\`\`python
import os
import sentry_sdk

if not DEBUG:
    sentry_sdk.init(
        dsn=os.environ.get("SENTRY_DSN"),
        environment=os.environ.get("ENVIRONMENT", "production"),
    )
\`\`\``,
  },
  "python.flask": {
    content: `# Sentry Flask SDK Instrumentation

## Installation

\`\`\`bash
pip install sentry-sdk[flask]
\`\`\`

## Basic Setup

\`\`\`python
import sentry_sdk
from sentry_sdk.integrations.flask import FlaskIntegration
from flask import Flask

sentry_sdk.init(
    dsn="YOUR_DSN_HERE",
    integrations=[FlaskIntegration()],
    traces_sample_rate=1.0,
)

app = Flask(__name__)
\`\`\``,
  },
  "go.gin": {
    content: `# Sentry Go SDK with Gin Framework

## Installation

\`\`\`bash
go get github.com/getsentry/sentry-go
go get github.com/getsentry/sentry-go/gin
\`\`\`

## Basic Setup

\`\`\`go
package main

import (
    "github.com/gin-gonic/gin"
    "github.com/getsentry/sentry-go"
    sentrygin "github.com/getsentry/sentry-go/gin"
)

func main() {
    err := sentry.Init(sentry.Options{
        Dsn: "YOUR_DSN_HERE",
        TracesSampleRate: 1.0,
    })
    if err != nil {
        log.Fatalf("sentry.Init: %s", err)
    }

    app := gin.Default()
    app.Use(sentrygin.New(sentrygin.Options{}))
    
    // Your routes here
}
\`\`\``,
  },
  "java.spring": {
    content: `# Sentry Java SDK with Spring Boot

## Installation

Add to your \`pom.xml\`:

\`\`\`xml
<dependency>
    <groupId>io.sentry</groupId>
    <artifactId>sentry-spring-boot-starter</artifactId>
    <version>6.28.0</version>
</dependency>
\`\`\`

## Configuration

Add to \`application.properties\`:

\`\`\`properties
sentry.dsn=YOUR_DSN_HERE
sentry.traces-sample-rate=1.0
sentry.environment=production
\`\`\`

## Custom Configuration

\`\`\`java
@Configuration
public class SentryConfig {
    
    @Bean
    public SentryOptions sentryOptions() {
        SentryOptions options = new SentryOptions();
        options.setDsn("YOUR_DSN_HERE");
        options.setTracesSampleRate(1.0);
        return options;
    }
}
\`\`\``,
  },
} as const;

/**
 * Custom error class for SDK context fetching failures
 */
export class SdkContextError extends Error {
  constructor(
    message: string,
    public sdk: string,
    public source: string,
    public originalError?: Error,
  ) {
    super(message);
    this.name = "SdkContextError";
  }
}

/**
 * HTTP client service for fetching SDK-specific instrumentation context
 */
export class SdkContextClient {
  private cache = new Map<string, SdkContext>();
  private baseUrl: string;
  private timeout: number;

  constructor({
    baseUrl = "https://docs.sentry.io/llm-context",
    timeout = 10000,
  }: {
    baseUrl?: string;
    timeout?: number;
  } = {}) {
    this.baseUrl = baseUrl;
    this.timeout = timeout;
  }

  /**
   * Generate cache key for SDK context
   */
  private getCacheKey(sdk: string, version: string): string {
    return `${sdk}:${version}`;
  }

  /**
   * Check if context is cached and still fresh (within 1 hour)
   */
  private getCachedContext(sdk: string, version: string): SdkContext | null {
    const key = this.getCacheKey(sdk, version);
    const cached = this.cache.get(key);
    
    if (!cached) {
      return null;
    }

    const fetchedAt = new Date(cached.fetchedAt);
    const now = new Date();
    const hoursSinceFetch = (now.getTime() - fetchedAt.getTime()) / (1000 * 60 * 60);
    
    // Cache expires after 1 hour
    if (hoursSinceFetch > 1) {
      this.cache.delete(key);
      return null;
    }

    return cached;
  }

  /**
   * Store context in cache
   */
  private setCachedContext(context: SdkContext): void {
    const key = this.getCacheKey(context.sdk, context.version);
    this.cache.set(key, context);
  }

  /**
   * Generate endpoint URLs for SDK context fetching
   */
  private getContextUrls(sdk: string, version: string): string[] {
    const urls: string[] = [];

    // Primary endpoint pattern
    urls.push(`${this.baseUrl}/${sdk}/${version}/rules.md`);
    
    // Alternative patterns for different documentation structures
    urls.push(`${this.baseUrl}/${sdk}/${version}/instrumentation.md`);
    urls.push(`${this.baseUrl}/${sdk}/${version}/setup.md`);

    // Fallback to latest if specific version fails
    if (version !== "latest") {
      urls.push(`${this.baseUrl}/${sdk}/latest/rules.md`);
      urls.push(`${this.baseUrl}/${sdk}/latest/instrumentation.md`);
    }

    return urls;
  }

  /**
   * Fetch content from a single URL with timeout
   */
  private async fetchWithTimeout(url: string): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      // Check if fetch is available
      if (typeof globalThis.fetch === "undefined") {
        throw new Error(
          "fetch is not available. Please use Node.js >= 18 or ensure fetch is available in your environment.",
        );
      }

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Sentry-MCP-Server/1.0",
          "Accept": "text/markdown, text/plain, */*",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.text();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Try fetching from multiple URLs until one succeeds
   */
  private async fetchFromUrls(urls: string[]): Promise<{ content: string; source: string }> {
    const errors: Error[] = [];

    for (const url of urls) {
      try {
        const content = await this.fetchWithTimeout(url);
        if (content.trim().length > 0) {
          return { content, source: url };
        }
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }

    // All URLs failed
    const errorMessages = errors.map(e => e.message).join(", ");
    throw new Error(`Failed to fetch from all URLs: ${errorMessages}`);
  }

  /**
   * Get built-in fallback content for a specific SDK
   */
  private getBuiltInContext(sdk: string): string | null {
    const normalizedSdk = sdk.toLowerCase();
    
    // Direct match
    if (normalizedSdk in BUILT_IN_SDK_CONTEXT) {
      return BUILT_IN_SDK_CONTEXT[normalizedSdk as keyof typeof BUILT_IN_SDK_CONTEXT].content;
    }

    // Pattern matching for variations
    if (normalizedSdk.includes("react") || normalizedSdk.includes("javascript")) {
      return BUILT_IN_SDK_CONTEXT["javascript.react"].content;
    }
    
    if (normalizedSdk.includes("django") || (normalizedSdk.includes("python") && normalizedSdk.includes("django"))) {
      return BUILT_IN_SDK_CONTEXT["python.django"].content;
    }
    
    if (normalizedSdk.includes("flask") || (normalizedSdk.includes("python") && normalizedSdk.includes("flask"))) {
      return BUILT_IN_SDK_CONTEXT["python.flask"].content;
    }
    
    if (normalizedSdk.includes("gin") || (normalizedSdk.includes("go") && normalizedSdk.includes("gin"))) {
      return BUILT_IN_SDK_CONTEXT["go.gin"].content;
    }
    
    if (normalizedSdk.includes("spring") || (normalizedSdk.includes("java") && normalizedSdk.includes("spring"))) {
      return BUILT_IN_SDK_CONTEXT["java.spring"].content;
    }

    return null;
  }

  /**
   * Fetch SDK-specific instrumentation context
   */
  async fetchSdkContext(config: SdkContextConfig): Promise<SdkContext> {
    const {
      sdk,
      version = "latest",
      fallbackToBuiltIn = true,
    } = config;

    // Check cache first
    const cached = this.getCachedContext(sdk, version);
    if (cached) {
      return cached;
    }

    let content: string;
    let source: string;

    try {
      // Attempt to fetch from remote endpoints
      const urls = this.getContextUrls(sdk, version);
      const result = await this.fetchFromUrls(urls);
      content = result.content;
      source = result.source;
    } catch (networkError) {
      // Network fetch failed, try built-in fallback
      if (fallbackToBuiltIn) {
        const builtInContent = this.getBuiltInContext(sdk);
        if (builtInContent) {
          content = builtInContent;
          source = "built-in";
        } else {
          throw new SdkContextError(
            `Failed to fetch SDK context for ${sdk} and no built-in fallback available`,
            sdk,
            "network",
            networkError instanceof Error ? networkError : new Error(String(networkError)),
          );
        }
      } else {
        throw new SdkContextError(
          `Failed to fetch SDK context for ${sdk}`,
          sdk,
          "network",
          networkError instanceof Error ? networkError : new Error(String(networkError)),
        );
      }
    }

    // Create and cache the context
    const context: SdkContext = {
      sdk,
      version,
      content,
      fetchedAt: new Date().toISOString(),
      source,
    };

    this.setCachedContext(context);
    return context;
  }

  /**
   * Batch fetch multiple SDK contexts
   */
  async fetchMultipleSdkContexts(configs: SdkContextConfig[]): Promise<SdkContext[]> {
    const results = await Promise.allSettled(
      configs.map(config => this.fetchSdkContext(config))
    );

    const contexts: SdkContext[] = [];
    const errors: SdkContextError[] = [];

    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        contexts.push(result.value);
      } else {
        errors.push(
          new SdkContextError(
            `Failed to fetch context for ${configs[index].sdk}`,
            configs[index].sdk,
            "batch",
            result.reason,
          )
        );
      }
    });

    // If some succeeded, return those; if all failed, throw
    if (contexts.length > 0) {
      return contexts;
    }
    throw new Error(`All SDK context fetches failed: ${errors.map(e => e.message).join("; ")}`);
  }

  /**
   * Clear all cached contexts
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }
} 
