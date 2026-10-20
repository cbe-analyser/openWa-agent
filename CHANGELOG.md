# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-20

First public release.

### Added

- WhatsApp Business Cloud API channel: verified webhooks, deduplication, delivery statuses, media download, text/buttons/templates, template management, 24-hour window enforcement, opt-out/opt-in keywords.
- Development simulator that uses the same webhook pipeline as real traffic.
- AI provider adapters for Anthropic, OpenAI-compatible APIs, Ollama and an offline mock; routing with explicit fallback permission, retries, timeouts, token budgets, usage and cost estimates, health checks.
- Agent workflow (receive → identify → understand → retrieve → reason/act → verify → respond → record → follow up/escalate) with Copilot, Supervised and Autonomous modes, configurable custom intents, escalation rules and output safety checks.
- Knowledge base with PDF/DOCX/TXT/MD/CSV upload, FAQ, URL import, chunking, configurable embeddings and hybrid pgvector + full-text retrieval.
- Tools framework with built-in tools, configurable HTTP tools, permission levels, approvals and execution logs.
- Durable follow-ups with timezone support, deduplication, cancellation and opt-out enforcement.
- Dashboard (inbox, takeover, drafts, customers, tickets, follow-ups, settings, analytics, usage, audit log, health, developer API, security).
- Multi-tenant organizations with roles, invitations, scoped API keys, signed outbound webhooks, idempotency keys and an OpenAPI 3.1 document.
- PostgreSQL job queue and worker with retries, dead-letter queue, stale-job recovery and graceful shutdown.
- Docker image, Compose stack with optional Caddy HTTPS and Ollama, CI and dependency-audit workflows.
