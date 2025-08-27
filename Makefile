.PHONY: setup-env clean

# Clean all generated files, caches, and dependencies
clean:
	@echo "🧹 Cleaning build outputs, caches, and dependencies..."
	@echo ""
	
	@# Remove all node_modules directories
	@echo "Removing node_modules..."
	@find . -name "node_modules" -type d -prune -exec rm -rf {} + 2>/dev/null || true
	
	@# Remove all dist directories (build outputs)
	@echo "Removing dist directories..."
	@find . -name "dist" -type d -prune -exec rm -rf {} + 2>/dev/null || true
	
	@# Remove all .turbo directories (turbo cache)
	@echo "Removing .turbo cache directories..."
	@find . -name ".turbo" -type d -prune -exec rm -rf {} + 2>/dev/null || true
	
	@# Remove coverage directories
	@echo "Removing coverage directories..."
	@find . -name "coverage" -type d -prune -exec rm -rf {} + 2>/dev/null || true
	
	@# Remove Cloudflare wrangler cache
	@echo "Removing .wrangler cache directories..."
	@find . -name ".wrangler" -type d -prune -exec rm -rf {} + 2>/dev/null || true
	
	@# Remove pnpm store (optional - uncomment if you want to clean the global pnpm cache too)
	@# pnpm store prune
	
	@echo ""
	@echo "✅ Clean complete!"
	@echo ""
	@echo "To reinstall dependencies, run: pnpm install"

# Set up environment files for local development
setup-env:
	@echo "Setting up environment files for local development..."
	@echo ""
	
	@# Create root .env if it doesn't exist
	@if [ ! -f .env ]; then \
		echo "Creating root .env from .env.example..."; \
		cp .env.example .env; \
		echo "✅ Created .env in project root"; \
		echo ""; \
		echo "⚠️  Please edit .env and add your OPENAI_API_KEY"; \
	else \
		echo "✅ Root .env already exists"; \
	fi
	@echo ""
	
	@# Create cloudflare .env if it doesn't exist
	@if [ ! -f packages/mcp-cloudflare/.env ]; then \
		echo "Creating packages/mcp-cloudflare/.env from .env.example..."; \
		cp packages/mcp-cloudflare/.env.example packages/mcp-cloudflare/.env; \
		echo "✅ Created packages/mcp-cloudflare/.env"; \
		echo ""; \
		echo "⚠️  Please edit packages/mcp-cloudflare/.env and add:"; \
		echo "   - SENTRY_CLIENT_ID"; \
		echo "   - SENTRY_CLIENT_SECRET"; \
		echo "   - COOKIE_SECRET"; \
		echo ""; \
		echo "📖 See README.md for instructions on creating a Sentry OAuth App"; \
	else \
		echo "✅ packages/mcp-cloudflare/.env already exists"; \
	fi
	@echo ""
	@echo "🎉 Environment setup complete!"
	@echo ""
	@echo "Next steps:"
	@echo "1. Edit the .env files with your credentials"
	@echo "2. Run 'pnpm dev' to start the development server"