# OpenWa Agent

Open-source, self-hostable AI agent for WhatsApp customer support, automated troubleshooting, knowledge-grounded responses, and human handoff. Bring your own AI provider.

> **Not affiliated with WhatsApp or Meta.** OpenWa Agent is independent software that connects to the official [WhatsApp Business Platform (Cloud API)](https://developers.facebook.com/docs/whatsapp/cloud-api). "WhatsApp" is a trademark of WhatsApp LLC. The product name is configurable (`APP_NAME`).

## What it does

- **Answers customers on WhatsApp** through the official Cloud API: verified webhooks, delivery statuses, media, interactive buttons and message templates, with the 24-hour service window enforced.
- **Grounds answers in your knowledge base.** Upload PDF, DOCX, TXT, Markdown or CSV files, add FAQs or import public web pages. Retrieval is hybrid (pgvector plus PostgreSQL full-text search). When nothing relevant is found, the agent says so instead of guessing.
- **Takes actions through tools you control:** tickets, complaints, follow-ups, customer lookups and your own HTTP APIs. Every call is schema-validated, permission-checked, logged and, for high-impact actions, held for human approval.
- **Hands over to people cleanly.** Escalations pause the AI, send a fixed holding message and put the conversation in your inbox. A team member can take over at any time; the AI never replies on top of a human.
- **Works with your choice of AI:** Anthropic Claude, any OpenAI-compatible API (OpenAI, vLLM, LM Studio, OpenRouter and others) or a self-hosted Ollama model. Keys stay on the server, encrypted. Conversations only go to a fallback provider you explicitly allow.
- **Three autonomy levels:** Copilot (every reply is a draft), Supervised (low-risk intents are sent automatically) and Autonomous. Escalation rules, a per-conversation pause, an organization pause and a global emergency switch apply in every mode.

## Screens

Inbox with AI/human control indicators, conversation view with drafts and audit trail, WhatsApp simulator, customers, tickets, follow-ups, AI agent settings, knowledge base, tools and approvals, WhatsApp connections, team, analytics, usage and costs, audit log, system health, developer API, security and privacy, and a setup guide. Every page is mobile-first and shows only stored data, with loading, empty, error and offline states.

## Quick start (Docker)

Requirements: Docker with Compose v2.

```bash
git clone https://github.com/cbe-analyser/openwa-agent.git
cd openwa-agent
cp .env.example .env
# Edit .env and set at least:
#   ENCRYPTION_KEY    node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
#   POSTGRES_PASSWORD a long random password
#   APP_URL           the URL you will open in the browser (https://… in production)
docker compose up -d --build
```

Open `APP_URL` and create the first account; it becomes the instance administrator. Then follow **Setup & docs** in the dashboard.

To try it without any WhatsApp or AI credentials, set `DEPLOYMENT_MODE=sandbox` before the first sign-up, or load the demo organization:

```bash
docker compose exec -e SEED_ADMIN_EMAIL=you@example.com app node dist/seed.cjs --force
```

The demo uses the built-in simulator and an offline **mock** AI provider (keyword rules, not a language model), so you can see the whole pipeline before connecting anything.

For HTTPS with automatic certificates, set `DOMAIN` in `.env` and run `docker compose --profile https up -d`. See [docs/deployment.md](docs/deployment.md).

## Local development

Requirements: Node.js 20.11+ (22 recommended) and PostgreSQL 14+ with the [pgvector](https://github.com/pgvector/pgvector) extension.

```bash
npm ci
cp .env.example .env          # set DATABASE_URL and ENCRYPTION_KEY
npx prisma migrate deploy
npm run db:seed               # optional demo organization; prints a one-time password
npm run dev                   # dashboard and API on http://localhost:3000
npm run worker                # background worker (second terminal)
```

| Command                                                       | What it does                                                             |
| ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `npm run build`                                               | Production build of the app (Next.js standalone) and the worker bundle   |
| `npm test`                                                    | Unit and integration tests (needs a PostgreSQL test database, see below) |
| `npm run test:e2e`                                            | Browser tests against the production build (run `npm run build` first)   |
| `npm run lint` / `npm run typecheck` / `npm run format:check` | Static checks                                                            |
| `npm run secrets:check`                                       | Scans tracked files for credentials before you commit                    |
| `npm run audit:deps`                                          | Fails on high or critical vulnerabilities in production dependencies     |
| `npm run secrets:reencrypt`                                   | Re-encrypts stored secrets after rotating `ENCRYPTION_KEY`               |

Tests need no real credentials. Integration tests use `TEST_DATABASE_URL` (default `postgresql://openwa:openwa@localhost:5432/openwa_test`); the E2E suite uses `E2E_DATABASE_URL` (default `…/openwa_e2e`). Both databases must exist; migrations are applied automatically and never reset.

## Architecture in one paragraph

A Next.js application serves the dashboard and the REST API. WhatsApp webhooks are verified, deduplicated and stored in one transaction, then a separate **worker** process picks jobs from a PostgreSQL-backed queue (`FOR UPDATE SKIP LOCKED`, retries with exponential backoff, dead-letter state). The agent engine classifies the message, retrieves knowledge, lets the model call tools, checks the draft with deterministic safety rules, and a pure policy function decides whether to send, draft, escalate or ignore. No Redis or other services are required. Details: [docs/architecture.md](docs/architecture.md).

## Documentation

| Topic                                      |                                                                                  |
| ------------------------------------------ | -------------------------------------------------------------------------------- |
| [WhatsApp setup](docs/whatsapp-setup.md)   | Meta app, permanent token, webhook, templates, limits                            |
| [AI providers](docs/ai-providers.md)       | Anthropic, OpenAI-compatible, Ollama (with hardware notes), fallback and budgets |
| [Deployment](docs/deployment.md)           | VPS, Docker, HTTPS, sizing                                                       |
| [Operations](docs/operations.md)           | Backups, restore, upgrades, credential rotation, monitoring                      |
| [Developer API](docs/api.md)               | REST API, API keys, idempotency, outbound webhooks                               |
| [Architecture](docs/architecture.md)       | Components, data flow, agent workflow                                            |
| [Extending](docs/extending.md)             | Adding tools, AI providers and channels                                          |
| [Threat model](docs/threat-model.md)       | Assets, threats and mitigations                                                  |
| [Data protection](docs/data-protection.md) | Privacy features and a Kenya Data Protection Act 2019 checklist                  |
| [Limitations](docs/limitations.md)         | What it does not do, and platform limits                                         |
| [Troubleshooting](docs/troubleshooting.md) | Common problems                                                                  |
| [Testing](docs/testing.md)                 | Test suites and what they cover                                                  |

## Important limits

- The official API only delivers messages sent to your business number **after** it is connected. It cannot read personal chats or import past WhatsApp history.
- Outside the 24-hour customer service window only pre-approved templates can be sent.
- Using a number that is already on the WhatsApp Business app, or using the app and the API together, depends on Meta's eligibility rules.
- No browser automation, QR-code sessions or unofficial WhatsApp libraries are used or supported.

## Contributing and security

Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

[Apache License 2.0](LICENSE). See [NOTICE](NOTICE).
