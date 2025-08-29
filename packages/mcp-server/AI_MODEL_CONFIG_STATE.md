# AI Model Configuration - Current State

## Overview
We've implemented a flexible AI model configuration system using Vercel AI SDK with support for multiple providers through environment variables.

## Completed Work

### 1. Provider Registry Implementation (`src/internal/ai-providers.ts`)
- Created `createAIRegistry()` function that builds a provider registry from environment variables
- Created `getConfiguredModel()` function for easy model selection
- Support for 4 main providers + custom OpenAI-compatible endpoints

### 2. Supported Providers & Models

#### OpenAI
- **Models**: `gpt-5`, `gpt-4o`
- **Env var**: `OPENAI_API_KEY`
- **Notes**: GPT-5 released Aug 2025, best for coding/agentic tasks

#### Anthropic  
- **Models**: `claude-sonnet-4-20250514`
- **Env var**: `ANTHROPIC_API_KEY`
- **Notes**: Claude 4 Sonnet released May 2025

#### Google
- **Models**: `gemini-2.5-flash`
- **Env var**: `GOOGLE_GENERATIVE_AI_API_KEY`
- **Notes**: Fast with thinking capabilities

#### xAI
- **Models**: `grok-4`
- **Env var**: `XAI_API_KEY`
- **Notes**: Latest Grok model

#### Custom OpenAI-Compatible
- **Configuration**: Set both `OPENAI_API_KEY` and `AI_SDK_BASE_URL`
- **Use cases**: OpenRouter, local LLMs, any OpenAI-compatible API
- **Example**: `AI_SDK_BASE_URL=https://openrouter.ai/api/v1`

### 3. Model Selection
- **Environment variable**: `AI_SDK_MODEL`
- **Format**: `"provider:model"` or just `"model"` (auto-detects provider)
- **Default**: `"openai:gpt-4o"`
- **Auto-detection patterns**:
  - `claude*` or `*sonnet*` → Anthropic
  - `gemini*` → Google
  - `grok*` → xAI
  - `gpt*` → OpenAI
  - Others → Default to OpenAI

### 4. Integration Points
- Updated `callEmbeddedAgent.ts` to use `getConfiguredModel()`
- All embedded agents now use the configured model
- Tests pass with mocked providers

### 5. Dependencies Added
- `@ai-sdk/anthropic@^2.0.9`
- `@ai-sdk/google@^2.0.11`
- `@ai-sdk/xai@^2.0.13`
- (Already had `@ai-sdk/openai@^1.3.22`)

## Next Steps / Future Considerations

1. **Model-specific optimizations**: Different models may need different prompt strategies
2. **Cost tracking**: Add usage/cost tracking per provider
3. **Fallback strategy**: Implement fallback to secondary model if primary fails
4. **Model capabilities**: Some models may not support all features (e.g., function calling)
5. **Rate limiting**: Handle provider-specific rate limits
6. **Testing**: Add integration tests with real API calls (currently only unit tests)

## Environment Configuration Example

```bash
# Choose your AI model
AI_SDK_MODEL=gpt-5  # or claude-sonnet-4-20250514, gemini-2.5-flash, grok-4

# Configure the appropriate API key
OPENAI_API_KEY=sk-...      # For GPT models
ANTHROPIC_API_KEY=sk-ant-...  # For Claude models
GOOGLE_GENERATIVE_AI_API_KEY=...  # For Gemini models
XAI_API_KEY=xai-...  # For Grok models

# Or use OpenRouter/custom provider
OPENAI_API_KEY=sk-or-...  # Your OpenRouter key
AI_SDK_BASE_URL=https://openrouter.ai/api/v1
```

## Testing
All tests pass. The configuration gracefully handles:
- Missing providers (throws error if no provider configured)
- Invalid model names (throws descriptive error)
- Auto-detection of provider from model name
- Custom OpenAI-compatible endpoints