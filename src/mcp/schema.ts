import { z } from "zod";

// Define the PlatformIntegration type
export const PlatformIntegrationSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  language: z.string(),
  link: z.string().url(),
});

export type PlatformIntegration = z.infer<typeof PlatformIntegrationSchema>;

// Extract all platform IDs for use in the enum
export const platformIds = [
  "android",
  "apple",
  "apple-ios",
  "apple-macos",
  "bun",
  "capacitor",
  "cordova",
  "dart",
  "deno",
  "dotnet",
  "dotnet-aspnet",
  "dotnet-aspnetcore",
  "dotnet-awslambda",
  "dotnet-gcpfunctions",
  "dotnet-maui",
  "dotnet-uwp",
  "dotnet-winforms",
  "dotnet-wpf",
  "dotnet-xamarin",
  "electron",
  "elixir",
  "flutter",
  "go",
  "go-echo",
  "go-fasthttp",
  "go-fiber",
  "go-gin",
  "go-http",
  "go-iris",
  "go-martini",
  "go-negroni",
  "godot",
  "ionic",
  "java",
  "java-log4j2",
  "java-logback",
  "java-spring",
  "java-spring-boot",
  "javascript",
  "javascript-angular",
  "javascript-astro",
  "javascript-ember",
  "javascript-gatsby",
  "javascript-nextjs",
  "javascript-react",
  "javascript-remix",
  "javascript-solid",
  "javascript-solidstart",
  "javascript-svelte",
  "javascript-sveltekit",
  "javascript-tanstackstart-react",
  "javascript-vue",
  "javascript-nuxt",
  "kotlin",
  "minidump",
  "native",
  "native-qt",
  "nintendo-switch",
  "node",
  "node-awslambda",
  "node-azurefunctions",
  "node-cloudflare-pages",
  "node-cloudflare-workers",
  "node-connect",
  "node-express",
  "node-fastify",
  "node-hapi",
  "node-gcpfunctions",
  "node-koa",
  "node-nestjs",
  "php",
  "php-laravel",
  "php-symfony",
  "powershell",
  "python",
  "python-aiohttp",
  "python-asgi",
  "python-awslambda",
  "python-bottle",
  "python-celery",
  "python-chalice",
  "python-django",
  "python-falcon",
  "python-fastapi",
  "python-flask",
  "python-gcpfunctions",
  "python-pylons",
  "python-pymongo",
  "python-pyramid",
  "python-quart",
  "python-rq",
  "python-sanic",
  "python-serverless",
  "python-starlette",
  "python-tornado",
  "python-tryton",
  "python-wsgi",
  "react-native",
  "ruby",
  "ruby-rack",
  "ruby-rails",
  "rust",
  "unity",
  "unreal",
  "other",
] as const;

export const ParamOrganizationSlug = z
  .string()
  .describe(
    "The organization's slug. This will default to the first org you have access to.",
  );

export const ParamTeamSlug = z
  .string()
  .describe(
    "The team's slug. This will default to the first team you have access to.",
  );

export const ParamIssueShortId = z
  .string()
  .describe("The Issue ID. e.g. `PROJECT-1Z43`");

// Modified to accept any string (platform name or ID)
export const ParamPlatform = z
  .string()
  .describe(
    "The platform for the project (e.g., Python, Node.js, React, etc.)",
  );
