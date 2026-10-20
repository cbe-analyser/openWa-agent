# Developer API

The REST API lives under `/api/v1`. The dashboard uses the same API, so everything you can do in the dashboard is available programmatically, except account and security administration (team, API keys, sessions, passwords, provider credentials, kill switch), which requires a signed-in session.

The machine-readable OpenAPI 3.1 description is served at **`GET /api/v1/openapi.json`** (no authentication). A test checks that every route in the codebase is documented there.

## Authentication

Create a key under **Developer API → API keys**. Choose the scopes the key needs and, optionally, an expiry. The full key is shown once; only a SHA-256 hash is stored.

```bash
curl -H "Authorization: Bearer $OPENWA_API_KEY" https://support.example.com/api/v1/conversations
```

Keys look like `owa_live_XXXXXXXX…`. The first 17 characters are a non-secret prefix shown in the dashboard so you can tell keys apart.

**Rotation.** `POST /api/v1/api-keys/{id}/rotate` returns a new key and revokes the old one immediately or after a grace period you choose (`graceDays`, 0 to 30), so you can deploy the new key without downtime. Revoke a key with `DELETE /api/v1/api-keys/{id}`.

### Scopes

| Scope                                        | Allows                                                                                        |
| -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `conversations:read` / `conversations:write` | List and read conversations; take over, release, pause, assign, tag, change status, add notes |
| `messages:send`                              | Send human messages and templates, approve or reject AI drafts                                |
| `customers:read`                             | Read customer profiles                                                                        |
| `tickets:read` / `tickets:write`             | Read, create and update tickets                                                               |
| `followups:read` / `followups:write`         | Read, schedule and cancel follow-ups                                                          |
| `knowledge:read` / `knowledge:write`         | Search and read documents; add, edit, re-index and delete them                                |
| `integrations:read` / `integrations:write`   | Channels, templates, tools, tool approvals, outbound webhooks                                 |
| `usage:read`                                 | Usage, cost and analytics                                                                     |
| `health:read`                                | System health and jobs                                                                        |
| `workflows:trigger`                          | The workflow endpoints below (plus the scope of the underlying action)                        |

Keys belong to one organization and can never read another organization's data.

## Conventions

- Request and response bodies are JSON. Timestamps are ISO 8601 in UTC.
- Lists return `{ "items": [...], "nextCursor": "…" | null }`. Pass `?cursor=` to get the next page and `?limit=` (max 100) to change the page size.
- Errors return a non-2xx status and:
  ```json
  { "error": { "code": "validation_error", "message": "…", "details": {} }, "requestId": "…" }
  ```
  Include the `requestId` when reporting a problem; it is also in the server logs.
- Rate limits return `429` with `Retry-After`.

### Idempotency

`POST` requests to conversation actions, tickets, follow-ups and workflows accept an `Idempotency-Key` header (up to 200 characters). Keys are kept for at least 24 hours (stored keys are purged after 48). Repeating a request with the same key returns the stored response with `Idempotent-Replayed: true` instead of performing the action twice. Reusing a key with a different body returns `409 idempotency_mismatch`.

## Endpoints

The OpenAPI document has the full schemas. The most common calls:

| Method and path                                                                              | Purpose                                           |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `GET /conversations?status=&control=&intent=&q=&unread=&assignedToMe=`                       | List conversations                                |
| `GET /conversations/{id}`                                                                    | Conversation with messages, AI runs and notes     |
| `POST /conversations/{id}/takeover`                                                          | A person takes control; the AI stops replying     |
| `POST /conversations/{id}/release`                                                           | Return control to the AI                          |
| `POST /conversations/{id}/pause` / `resume`                                                  | Pause or resume the AI for this conversation      |
| `POST /conversations/{id}/messages` `{text}`                                                 | Send a human reply (inside the 24-hour window)    |
| `POST /conversations/{id}/template` `{name, language, bodyParams}`                           | Send an approved template                         |
| `POST /conversations/{id}/status` `{status, resolutionNote?}`                                | `OPEN`, `PENDING`, `ESCALATED` or `RESOLVED`      |
| `POST /conversations/{id}/assign` `{userId}`                                                 | Assign or unassign                                |
| `POST /conversations/{id}/notes` `{body}`                                                    | Internal note (never sent to the customer)        |
| `POST /conversations/{id}/tags` `{tags}`                                                     | Replace tags                                      |
| `GET /conversations/{id}/export`                                                             | Export the conversation as JSON                   |
| `POST /messages/{id}/approve` `{text?}` / `POST /messages/{id}/reject`                       | Approve (optionally edited) or reject an AI draft |
| `GET /customers`, `GET /customers/{id}`, `GET /customers/{id}/export`                        | Customers and data-subject export                 |
| `GET /tickets`, `POST /tickets`, `PATCH /tickets/{id}`                                       | Tickets                                           |
| `GET /followups`, `POST /followups`, `DELETE /followups/{id}`                                | Follow-ups                                        |
| `GET /knowledge/documents`, `POST /knowledge/documents`, `PATCH`, `DELETE`, `POST …/reindex` | Knowledge base                                    |
| `POST /knowledge/search` `{query}`                                                           | Run retrieval exactly as the agent does           |
| `GET /tools/executions`, `POST /tools/executions/{id}` `{approve}`                           | Review tool calls and decide pending approvals    |
| `GET /usage?days=`, `GET /analytics?days=`                                                   | Usage, cost and support metrics                   |
| `GET /health`                                                                                | Component health, queue depth and dead jobs       |

### Workflows

`POST /api/v1/workflows/{name}` triggers a predefined, authorized action. Each needs `workflows:trigger` plus the scope of the underlying action.

| Name                    | Body                                            | Effect                                                         |
| ----------------------- | ----------------------------------------------- | -------------------------------------------------------------- |
| `escalate-conversation` | `{conversationId, reason}`                      | Hands the conversation to humans                               |
| `resolve-conversation`  | `{conversationId, resolutionNote?}`             | Marks it resolved                                              |
| `send-template`         | `{conversationId, name, language, bodyParams?}` | Sends an approved template                                     |
| `refresh-url-document`  | `{documentId}`                                  | Re-fetches a URL-imported knowledge document and re-indexes it |

## Outbound webhooks

Register endpoints under **Developer API → Webhooks** (or `POST /api/v1/webhooks`) and choose events:

`message.received`, `message.sent`, `message.failed`, `conversation.escalated`, `conversation.resolved`, `conversation.control_changed`, `ticket.created`, `ticket.updated`, `followup.sent`, `tool.approval_requested`.

Each delivery is a `POST` with:

```json
{ "id": "evt_…", "type": "conversation.escalated", "created_at": "2026-10-20T08:00:00.000Z", "data": {} }
```

Headers: `X-OpenWa-Event`, `X-OpenWa-Delivery` (the event ID, stable across retries) and `X-OpenWa-Signature`.

Deliveries are durable jobs: non-2xx responses and timeouts (10 s) are retried with exponential backoff up to 8 attempts. Endpoints must use HTTPS in production (`NODE_ENV=production`); private network addresses are refused unless `ALLOW_PRIVATE_NETWORK_FETCH=true`.

### Verifying signatures

```
X-OpenWa-Signature: t=1760947200,v1=5f0c…
```

`v1` is the hex HMAC-SHA256 of `"{t}.{raw request body}"` using the endpoint's signing secret (shown once when you create the endpoint). Reject requests whose `t` is more than 5 minutes old, and compare in constant time:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

export function verify(rawBody, header, secret, toleranceSec = 300) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2)));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const given = Buffer.from(parts.v1 ?? "", "hex");
  return given.length === expected.length / 2 && timingSafeEqual(given, Buffer.from(expected, "hex"));
}
```

Use the event `id` to ignore duplicates.
