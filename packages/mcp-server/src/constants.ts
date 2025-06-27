/**
 * Constants for Sentry MCP server.
 *
 * Defines platform and framework combinations available in Sentry documentation.
 */

/**
 * Common Sentry platforms that have documentation available
 */
export const SENTRY_PLATFORMS_BASE = [
  "javascript",
  "python",
  "react",
  "node",
  "java",
  "dotnet",
  "go",
  "php",
  "ruby",
  "android",
  "apple",
  "flutter",
  "unity",
  "unreal",
  "rust",
  "elixir",
  "kotlin",
  "native",
  "dart",
  "godot",
  "nintendo-switch",
  "playstation",
  "powershell",
  "react-native",
  "xbox",
] as const;

/**
 * Platform-specific frameworks that have Sentry guides
 */
export const SENTRY_FRAMEWORKS: Record<string, string[]> = {
  javascript: [
    "nextjs",
    "react",
    "vue",
    "angular",
    "hono",
    "svelte",
    "express",
    "fastify",
    "astro",
    "bun",
    "capacitor",
    "cloudflare",
    "connect",
    "cordova",
    "deno",
    "electron",
    "ember",
    "nuxt",
    "solid",
    "solidstart",
    "sveltekit",
    "tanstack-react",
    "wasm",
  ],
  python: [
    "django",
    "flask",
    "fastapi",
    "celery",
    "tornado",
    "pyramid",
    "aiohttp",
    "anthropic",
    "airflow",
    "aws-lambda",
    "boto3",
    "bottle",
    "chalice",
    "dramatiq",
    "falcon",
    "langchain",
    "litestar",
    "logging",
    "loguru",
    "openai",
    "quart",
    "ray",
    "redis",
    "rq",
    "sanic",
    "sqlalchemy",
    "starlette",
  ],
  node: ["express", "fastify", "koa", "nestjs", "hapi"],
  react: ["nextjs", "gatsby", "remix"],
  dotnet: [
    "aspnetcore",
    "maui",
    "wpf",
    "winforms",
    "aspnet",
    "aws-lambda",
    "azure-functions",
    "blazor-webassembly",
    "entityframework",
    "google-cloud-functions",
    "extensions-logging",
    "log4net",
    "nlog",
    "serilog",
    "uwp",
    "xamarin",
  ],
  java: [
    "spring",
    "spring-boot",
    "android",
    "jul",
    "log4j2",
    "logback",
    "servlet",
  ],
  go: [
    "echo",
    "fasthttp",
    "fiber",
    "gin",
    "http",
    "iris",
    "logrus",
    "negroni",
    "slog",
    "zerolog",
  ],
  php: ["laravel", "symfony"],
  ruby: ["delayed_job", "rack", "rails", "resque", "sidekiq"],
  android: ["kotlin"],
  apple: ["ios", "macos", "watchos", "tvos", "visionos"],
  kotlin: ["multiplatform"],
} as const;

/**
 * All valid guides for Sentry docs search filtering.
 * A guide can be either a platform (e.g., 'javascript') or a platform/framework combination (e.g., 'javascript/nextjs').
 */
export const SENTRY_GUIDES = [
  // Base platforms
  ...SENTRY_PLATFORMS_BASE,
  // Platform/guide combinations
  ...Object.entries(SENTRY_FRAMEWORKS).flatMap(([platform, guides]) =>
    guides.map((guide) => `${platform}/${guide}`),
  ),
] as const;
