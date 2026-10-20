# Architecture

OpenWa Agent is two Node.js processes sharing one PostgreSQL database:

| Process    | Entry point                           | Responsibilities                                                                          |
| ---------- | ------------------------------------- | ----------------------------------------------------------------------------------------- |
| **app**    | `node server.js` (Next.js standalone) | Dashboard, REST API, WhatsApp webhook receiver, authentication                            |
| **worker** | `node dist/worker.cjs`                | Agent runs, outbound sends, knowledge ingestion, follow-ups, outbound webhooks, retention |

PostgreSQL (14+ with pgvector) is the only infrastructure dependency. It stores application data, embeddings, full-text indexes, rate-limit buckets, idempotency keys and the job queue.

```
 WhatsApp Cloud API ──webhook──▶ app ──(one transaction: verify, dedupe, store, enqueue)──▶ PostgreSQL
                                  ▲                                                          │
 Browser / API clients ───────────┘                                                     jobs table
                                                                                             │
 WhatsApp Cloud API ◀──send── worker ◀──────────── FOR UPDATE SKIP LOCKED ──────────────────┘
                                │
                                └──▶ AI provider (Anthropic / OpenAI-compatible / Ollama / mock)
```

## Source layout

| Path                                        | Contents                                                                               |
| ------------------------------------------- | -------------------------------------------------------------------------------------- |
| `src/app/(dashboard)`                       | Dashboard pages (client components using SWR)                                          |
| `src/app/api/v1`                            | REST API route handlers. Each uses the `route()` wrapper in `src/server/http/route.ts` |
| `src/app/api/webhooks/whatsapp/[channelId]` | Meta webhook handshake and receiver                                                    |
| `src/server/agent`                          | Agent engine, intents, prompts, deterministic safety checks, the policy function       |
| `src/server/ai`                             | Provider adapters, router (fallback, budgets, usage records), pricing                  |
| `src/server/channels`                       | Channel adapters (WhatsApp Cloud API, simulator), inbound ingestion, outbound queue    |
| `src/server/knowledge`                      | Text extraction, chunking, embeddings, hybrid retrieval                                |
| `src/server/tools`                          | Built-in tools, HTTP tools, executor with validation, permissions and approvals        |
| `src/server/jobs`                           | Queue, handlers and worker loop                                                        |
| `src/server/security`                       | Encryption, password hashing, rate limiting, redaction, SSRF guard                     |
| `src/server/services`                       | Business logic used by API routes and jobs                                             |
| `prisma/`                                   | Schema and SQL migrations                                                              |

## Request handling

Every API handler goes through `route()`, which:

1. Assigns a request ID (`x-request-id`).
2. Authenticates by session cookie or `Authorization: Bearer owa_live_…` API key.
3. Checks the permission declared by the route against the caller's role or key scopes.
4. For cookie-authenticated writes, requires a same-origin `Origin` header and `x-openwa-csrf: 1`.
5. Applies a per-identity rate limit (PostgreSQL buckets).
6. Replays a stored response for a repeated `Idempotency-Key`.
7. Converts errors into a JSON body without stack traces or secrets.

Every database query is scoped by the caller's organization ID. Cross-tenant access is covered by `tests/integration/tenant-isolation.test.ts`.

## Inbound message flow

1. **Webhook.** `POST /api/webhooks/whatsapp/{channelId}` verifies `X-Hub-Signature-256` with the channel's app secret against the raw body. Unsigned or wrongly signed requests are rejected with 401.
2. **Store.** In one transaction the payload is recorded as a `WebhookEvent`, each message is upserted by its WhatsApp message ID (duplicates are ignored), the customer and conversation are created or found, and a `process_inbound` job is enqueued. The webhook responds 200 only after the commit.
3. **Status updates** (`sent`, `delivered`, `read`, `failed`) update the matching outbound message. Status regressions are ignored.

## Agent workflow

`processInbound()` in `src/server/agent/engine.ts` runs for each inbound message:

| Step                 | What happens                                                                                                                                                                                                                                                                                 |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Receive / identify   | Load conversation, customer and organization. Handle opt-out and opt-in keywords deterministically. Skip if a newer customer message is waiting (bursts are answered once).                                                                                                                  |
| Gate                 | Stop if the conversation is under human control or paused, the organization or instance AI is paused, or the customer opted out.                                                                                                                                                             |
| Understand           | The model classifies intent, urgency, whether a human is requested, and the language. Deterministic detectors flag legal threats, security incidents, refunds, payments, sensitive data, abuse, spam and prompt injection.                                                                   |
| Retrieve             | Hybrid search over the knowledge base. Results below the evidence threshold count as "no evidence".                                                                                                                                                                                          |
| Reason / act         | Up to 4 tool rounds and 6 tool calls on one pinned provider. Tool input is validated; write and high-impact tools may be held for approval.                                                                                                                                                  |
| Verify               | The draft is parsed into `{reply, confidence, resolution, used_sources, …}`. Output checks look for requests for passwords or codes, leaked instructions, and unverified claims (prices, dates, refunds) without a source. Answers to business-fact intents need knowledge or a tool result. |
| Respond              | The pure `decide()` function in `policy.ts` returns SEND, DRAFT, ESCALATE or IGNORE. Escalation rules are evaluated first and no autonomy mode overrides them.                                                                                                                               |
| Record               | Under a row lock (so a human takeover cannot race the AI) the agent run, the message and the audit entry are stored and the send is queued.                                                                                                                                                  |
| Follow up / escalate | Schedule a follow-up if the agent asked for one, or hand off: control becomes `PENDING_HUMAN`, the fixed holding message is sent and an event is emitted.                                                                                                                                    |

Each `AgentRun` stores the steps, the classification, citations, tool calls, the policy decision with reasons, the provider and model used, and token usage. These are shown in the conversation view.

## Autonomy modes

| Mode       | Behaviour                                                                                                                  |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| Copilot    | Every AI reply is a draft that a person approves, edits or rejects.                                                        |
| Supervised | Replies for the intents you list are sent automatically when confidence meets the threshold. Everything else is a draft.   |
| Autonomous | Replies are sent when confidence meets the threshold. Below it, clarifying questions are sent and anything else escalates. |

In every mode, escalation rules, per-conversation pause, organization pause and the instance kill switch apply.

## Job queue

`src/server/jobs/queue.ts` implements a durable queue in the `Job` table:

- Workers claim jobs with `FOR UPDATE SKIP LOCKED`, so several worker processes can run safely.
- `dedupeKey` prevents duplicate jobs (one per WhatsApp message, webhook delivery, etc.).
- Failed jobs are retried with exponential backoff (5 s × 2ⁿ, capped at 1 hour) up to `maxAttempts`, then marked `DEAD`. Dead jobs are listed on **System health** and can be retried.
- Jobs locked by a crashed worker are recovered after a timeout.
- On `SIGTERM` the worker stops claiming jobs and waits for running jobs to finish.

Job types: `process_inbound`, `send_message`, `index_document`, `followup_due`, `summarize_conversation`, `deliver_webhook` and `retention_sweep` (hourly).

## AI routing

`AIRouter` resolves the organization's primary provider, then fallback providers in priority order, using only providers marked **allow as fallback**. A provider is skipped when its monthly token budget is used up. Every attempt, successful or not, writes a `UsageRecord` with tokens, latency and estimated cost. See [ai-providers.md](ai-providers.md).

## Knowledge retrieval

Documents are extracted (PDF, DOCX, TXT, Markdown, CSV, HTML), split into overlapping chunks along headings and paragraphs, embedded and indexed with a PostgreSQL `tsvector`. A query combines cosine similarity (pgvector) and full-text rank. Only chunks of `READY` documents in the caller's organization are searched. The default embedding is an offline lexical hash (no network); configure a neural embedding model for semantic search.

## Security boundaries

See [threat-model.md](threat-model.md).
