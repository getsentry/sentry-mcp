FROM node:lts-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS build
COPY . /app
WORKDIR /app
# ensure latest corepack otherwise we could hit cert issues
RUN npm i -g corepack@latest
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile
RUN pnpm run -r build
RUN pnpm deploy --filter=sentry-mcp --prod /prod/sentry-mcp

FROM base AS app
COPY --from=build /prod/sentry-mcp /app
WORKDIR /app
# Expose port if needed (though stdio doesn't need it, but may be used in dev)
EXPOSE 8788
# Run the MCP server via stdio transport
CMD ["npm", "run", "start", "--"]
