# Extending OpenWa Agent

Most integrations need no code: register an **HTTP tool** in the dashboard. Write code when you need a new built-in tool, an AI provider that is not OpenAI-compatible, or a new channel. Read [architecture.md](architecture.md) first and see [CONTRIBUTING.md](../CONTRIBUTING.md) for the development workflow.

## HTTP tools (no code)

**Tools & integrations → Add HTTP tool** lets the agent call your own REST API, for example an order-status lookup:

| Field                 | Example                                                                                                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name                  | `check_order_status` (lowercase, used by the model)                                                                                                                                |
| Description           | "Look up the delivery status of one of the customer's orders by order number." The model decides when to call a tool from this text, so be specific                                |
| Method / URL template | `GET https://api.example.com/orders/{order_id}`. Placeholders are filled from the input and URL-encoded                                                                            |
| Input schema          | JSON Schema for the input, e.g. `{"type":"object","properties":{"order_id":{"type":"string","pattern":"^[A-Z0-9-]{4,20}$"}},"required":["order_id"],"additionalProperties":false}` |
| Auth header + secret  | `Authorization` and `Bearer …`. Stored encrypted, never shown to the model                                                                                                         |
| Customer parameter    | Optional. Adds the customer's WhatsApp number as a parameter, bound on the server, so the model cannot look up someone else                                                        |
| Response path         | Optional dot path, e.g. `data.order`, to return only part of the response                                                                                                          |
| Permission            | `READ`, `WRITE` or `HIGH_IMPACT`. High-impact tools always need human approval                                                                                                     |

Calls go through the SSRF guard (no private addresses unless `ALLOW_PRIVATE_NETWORK_FETCH=true`), have a timeout, a 256 KB response limit, and are recorded under **Tools & integrations → Tool calls** with input, output and duration. Keep responses small: they are sent to the AI provider.

## Built-in tools

Built-in tools live in `src/server/tools/builtin.ts`. Each one is a `BuiltinToolDefinition`:

```ts
{
  name: "get_ticket_status",
  description: "Look up the status of one of the current customer's support tickets by ticket number.",
  permission: "READ",
  input: z.object({ ticket_number: z.coerce.number().int().positive() }).strict(), // validates model input
  parameters: { /* the same shape as JSON Schema, advertised to the model */ },
  timeoutMs: 5_000,
  needsConversation: true,
  async execute(input, ctx) {
    // ctx.orgId and ctx.customerId come from the server, never from the model.
    // Always filter queries by ctx.orgId.
  },
}
```

Rules:

- Validate everything with the zod schema. Never trust identifiers from the model; scope by `ctx.orgId` and, where relevant, `ctx.customerId`.
- Return small, plain JSON. Do not return secrets or other customers' data.
- Use `WRITE` for changes and `HIGH_IMPACT` for anything involving money, account changes or irreversible actions.
- Add tests to `tests/integration/operations.test.ts`.

New organizations get a `ToolConfig` row for each built-in tool when they are created. For existing organizations, add a migration that inserts the row, e.g. in `prisma/migrations/<timestamp>_add_my_tool/migration.sql`:

```sql
INSERT INTO "ToolConfig" ("id", "orgId", "name", "kind", "description", "permission", "enabled", "updatedAt")
SELECT 'tc_' || md5(random()::text), o."id", 'my_tool', 'BUILTIN', 'Short description', 'READ', true, now()
FROM "Organization" o
ON CONFLICT DO NOTHING;
```

Check the column list against `prisma/schema.prisma` when you write it.

## AI providers

Most hosted and self-hosted models speak the OpenAI chat-completions API; use the **OpenAI-compatible** kind before writing code. For a different API:

1. Add a value to `AIProviderKind` in `prisma/schema.prisma` and create a migration (`npm run db:migrate:dev`).
2. Create `src/server/ai/providers/<name>.ts` extending `BaseProvider`. Implement `chat(input)` (map `AIRequest` messages, tools and JSON mode to the API and return `AIResponse` with text, tool calls, token usage and stop reason) and `healthCheck()`. Throw `ProviderError` with `retryable` set correctly so the base class retries only transient failures.
3. Register it in the factory in `src/server/ai/router.ts`.
4. Add defaults to `KIND_DEFAULTS` in `src/app/(dashboard)/agent/page.tsx` and the kind to the provider validation in `src/app/api/v1/settings/_lib/providerFields.ts`.
5. Add prices for known models in `src/server/ai/pricing.ts` (optional).
6. Test it against a local stub like the others in `tests/integration/providers.test.ts`.

Never log request bodies or keys; use the existing logger, which redacts.

## Channels

A channel adapter implements `ChannelAdapter` (`src/server/channels/types.ts`): `send`, `healthCheck`, and optionally `markRead`, `listTemplates`, `createTemplate` and `fetchMedia`. Inbound messages are normalized to `InboundMessage` and passed to `ingestWebhook` in `src/server/channels/inbound.ts`, which handles deduplication, customers, conversations and job creation. Register the adapter in `src/server/channels/registry.ts` and add a `ChannelKind`.

Only official, documented business APIs are accepted. Contributions that automate consumer apps or use unofficial libraries will not be merged.

## Knowledge retrieval

`KnowledgeRetriever` (`src/server/knowledge/retrieval.ts`) can be replaced with `setRetriever()`, for example to query an external search service. Embedding providers implement `EmbeddingProvider` in `src/server/knowledge/embeddings.ts`.

## Outbound events

To react to events without changing the code, subscribe a webhook endpoint ([api.md](api.md#outbound-webhooks)). To add an event type, add it to `WEBHOOK_EVENTS` in `src/server/services/events.ts`, call `emitEvent()` inside the same transaction as the change, and document it in `docs/api.md` and `src/server/openapi.ts`.
