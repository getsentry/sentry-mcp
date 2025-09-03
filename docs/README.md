# Contributor Docs

This directory contains contributor documentation used by humans and LLMs. To avoid duplication, the canonical documentation map and contributor workflow live in `CLAUDE.md` (also available as `AGENTS.md`).

## Purpose

- Central home for all contributor-focused docs (.mdc files)
- Consumed by tools (e.g., Cursor) via direct file references

## Start Here

- Doc map and workflow: see `CLAUDE.md` / `AGENTS.md`
- Per-topic guides live in this folder (e.g., `adding-tools.mdc`)

## Integration with Tools

- Cursor IDE: this folder is referenced directly as contextual rules
- Other AI tools: reference specific `.mdc` files as needed

## LLM-Specific

- Meta-docs live under `llms/` (e.g., `llms/document-scopes.mdc`)

## Maintenance

Update docs when patterns change, new tools are added, or common issues arise. Keep the index in `CLAUDE.md` authoritative; avoid mirroring it here.
