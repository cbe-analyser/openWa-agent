# Testing

No test needs real WhatsApp or AI credentials. AI calls use the deterministic mock provider or a local HTTP stub that imitates the Anthropic, OpenAI and Ollama APIs; WhatsApp uses the simulator channel or a stubbed Graph API.

## Suites

| Command            | Suite                                                                     | Needs                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `npm test`         | Unit and integration tests (Vitest), `tests/unit` and `tests/integration` | PostgreSQL with pgvector; database from `TEST_DATABASE_URL` (default `postgresql://openwa:openwa@localhost:5432/openwa_test`) |
| `npm run test:e2e` | Browser tests (Playwright, desktop and Pixel 7 viewports), `tests/e2e`    | `npm run build` first; database from `E2E_DATABASE_URL` (default `…/openwa_e2e`)                                              |

Both suites apply migrations with `prisma migrate deploy`; they never drop or reset the database. Integration tests truncate tables between tests, so **never point `TEST_DATABASE_URL` at a database you care about**. E2E tests create a uniquely named admin and data for each run.

Create the databases once:

```bash
createdb -U openwa openwa_test
createdb -U openwa openwa_e2e
```

## Coverage of the required areas

| Area                         | Where                                                                                                                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. AI provider adapters      | `integration/providers.test.ts`: Anthropic, OpenAI-compatible and Ollama against a local stub (request shape, tool calls, usage, refusals, retries, no retry on auth errors)                                              |
| B. Webhook validation        | `unit/whatsapp.test.ts` (signature), `integration/auth-api.test.ts` (handshake, unsigned and forged requests rejected)                                                                                                    |
| C. Duplicate webhooks        | `integration/pipeline.test.ts` ("deduplicates repeated webhook deliveries"), `auth-api.test.ts` (same event accepted idempotently)                                                                                        |
| D. Message processing        | `integration/pipeline.test.ts`: grounded answer, insufficient evidence, copilot drafts, injection                                                                                                                         |
| E. Conversation persistence  | `pipeline.test.ts` (messages, agent runs, statuses stored and read back)                                                                                                                                                  |
| F. Knowledge retrieval       | `integration/operations.test.ts` ("finds relevant passages and reports insufficient evidence"), `unit/misc.test.ts` (chunking, embeddings, extraction)                                                                    |
| G. Tool authorization        | `operations.test.ts` "tools framework": validation, tenant binding, unknown/disabled tools, approval for high-impact tools                                                                                                |
| H. Human takeover            | `pipeline.test.ts` (takeover supersedes a queued AI reply, release), E2E `support-flow.spec.ts`                                                                                                                           |
| I. AI pause and resume       | `pipeline.test.ts` (conversation and organization pause/resume, global kill switch)                                                                                                                                       |
| J. Escalation rules          | `unit/policy.test.ts`, `pipeline.test.ts` (refund escalation with holding message)                                                                                                                                        |
| K. Scheduled follow-ups      | `operations.test.ts` "follow-ups": dedupe, cancel, 24-hour window, templates, opt-out                                                                                                                                     |
| L. API authentication        | `auth-api.test.ts`: API keys, scopes, revocation, expiry, roles, CSRF, login lockout                                                                                                                                      |
| M. Tenant isolation          | `integration/tenant-isolation.test.ts`                                                                                                                                                                                    |
| N. Error handling            | `providers.test.ts` (all providers fail → escalation), `operations.test.ts` (Graph API permanent vs transient errors)                                                                                                     |
| O. Rate limiting             | `auth-api.test.ts` ("allows up to the limit within a window")                                                                                                                                                             |
| P. Secret redaction          | `unit/security.test.ts` (redaction, encryption, hints)                                                                                                                                                                    |
| Privacy and webhooks (extra) | `integration/privacy.test.ts`: customer export and erasure (owner only), retention sweep, signed outbound webhook delivery                                                                                                |
| Q. Opt-out enforcement       | `pipeline.test.ts` (opt-out keywords cancel follow-ups), `operations.test.ts` (no follow-up to opted-out customers)                                                                                                       |
| R. Database migrations       | `operations.test.ts` ("installed pgvector and the knowledge search indexes"), plus every run applies migrations from scratch in CI                                                                                        |
| S. Failure recovery          | `operations.test.ts` "durable job queue": retries, backoff, dead letter, retry, crashed-worker recovery                                                                                                                   |
| T. Frontend workflows        | `e2e/support-flow.spec.ts` (sign in → customer message → grounded AI reply → takeover → human reply → audit) and `e2e/pages.spec.ts` (all 18 pages render with data, no console errors, no horizontal overflow on mobile) |

`unit/misc.test.ts` also checks that the OpenAPI document and the route handlers match.

## Static checks

`npm run lint`, `npm run typecheck`, `npm run format:check`, `npm run secrets:check` and `npm run build` run in CI (`.github/workflows/ci.yml`) together with both test suites and a Docker build.

## What is not covered by automated tests

- Real calls to Meta's Graph API and real AI providers (they need credentials and cost money). Use the provider **Test** button and the connection **Check health** button after configuring them.
- Load and soak testing.
- Screen-reader testing beyond semantic markup and labelled controls.
