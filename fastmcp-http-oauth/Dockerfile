FROM node:22-alpine AS builder
RUN apk --no-cache add ca-certificates
COPY fastmcp-http-oauth/custom-cas /usr/local/share/ca-certificates
RUN update-ca-certificates
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files for the example
# This structure mirrors the monorepo: fastmcp-http-oauth/
COPY fastmcp-http-oauth/package.json fastmcp-http-oauth/pnpm-lock.yaml* ./fastmcp-http-oauth/

# Install dependencies in the example directory
WORKDIR /app/fastmcp-http-oauth
RUN pnpm install

# Copy mcp-core dist for TypeScript compilation
# Source paths resolve relative to source file location
COPY packages/mcp-core/dist /app/packages/mcp-core/dist

# Copy example source and config
COPY fastmcp-http-oauth/*.ts ./
COPY fastmcp-http-oauth/tsconfig.json ./

# Build example
RUN pnpm exec tsc

# ---- Production stage ----
FROM node:22-alpine

RUN apk --no-cache add ca-certificates
COPY fastmcp-http-oauth/custom-cas /usr/local/share/ca-certificates
RUN update-ca-certificates
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt
WORKDIR /app/fastmcp-http-oauth

# Allow mcp-core to find dependencies in the main node_modules
ENV NODE_PATH=/app/fastmcp-http-oauth/node_modules

# Copy built files and dependencies with correct structure
COPY --from=builder /app/fastmcp-http-oauth/dist ./dist
COPY --from=builder /app/fastmcp-http-oauth/node_modules ./node_modules
COPY --from=builder /app/fastmcp-http-oauth/package.json ./
# Copy mcp-core at the location that runtime imports will resolve to
# From dist/server.js, "../packages/" resolves to /app/fastmcp-http-oauth/packages/
COPY --from=builder /app/packages ./packages

# Create symlink so mcp-core can resolve its dependencies from main node_modules
RUN ln -s /app/fastmcp-http-oauth/node_modules ./packages/mcp-core/node_modules

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

USER nodejs

EXPOSE 3000

CMD ["node", "dist/server.js"]
