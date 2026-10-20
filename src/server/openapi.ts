import { API_KEY_SCOPES } from "./auth/permissions";
import { WEBHOOK_EVENTS } from "./services/events";

type Op = {
  summary: string;
  scope?: string;
  body?: Record<string, unknown>;
  query?: Array<[string, string, string?]>;
  idempotent?: boolean;
  sessionOnly?: boolean;
  response?: string;
};

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

const PATHS: Record<string, Record<string, Op>> = {
  "/overview": {
    get: {
      summary: "Dashboard metrics computed from stored records",
      scope: "conversations:read",
      query: [["days", "integer", "Look-back window (default 30)"]],
    },
  },
  "/analytics": {
    get: { summary: "Conversation analytics by day, intent and urgency", scope: "conversations:read" },
  },
  "/conversations": {
    get: {
      summary: "List conversations",
      scope: "conversations:read",
      query: [
        ["status", "string", "OPEN | PENDING | ESCALATED | RESOLVED"],
        ["control", "string", "AI | PENDING_HUMAN | HUMAN"],
        ["intent", "string"],
        ["unread", "boolean"],
        ["q", "string", "Search customer name, number or message text"],
        ["cursor", "string"],
        ["limit", "integer"],
      ],
    },
  },
  "/conversations/{id}": {
    get: {
      summary: "Conversation detail with messages, notes, tickets, agent runs and audit trail",
      scope: "conversations:read",
    },
  },
  "/conversations/{id}/{action}": {
    post: {
      summary:
        "Conversation action: takeover | release | pause | resume | assign | status | messages | template | notes | tags | read",
      scope: "conversations:write (messages/template: messages:send)",
      body: {
        type: "object",
        description:
          "Depends on action, e.g. status: {status, resolutionNote}; messages: {text}; template: {name, language, bodyParams}",
      },
      idempotent: true,
    },
    get: { summary: "Export conversation transcript (action = export)", scope: "data:export" },
  },
  "/messages/{id}/{decision}": {
    post: {
      summary: "Approve (optionally with edited text) or reject an AI draft",
      scope: "messages:send",
      body: { type: "object", properties: { text: { type: "string" } } },
    },
  },
  "/customers": {
    get: {
      summary: "List customers",
      scope: "customers:read",
      query: [
        ["q", "string"],
        ["tag", "string"],
        ["cursor", "string"],
        ["limit", "integer"],
      ],
    },
  },
  "/customers/{id}": {
    get: { summary: "Customer profile with conversations, tickets and timeline", scope: "customers:read" },
  },
  "/tickets": {
    get: {
      summary: "List support tickets",
      scope: "tickets:read",
      query: [
        ["status", "string"],
        ["q", "string"],
        ["cursor", "string"],
        ["limit", "integer"],
      ],
    },
    post: {
      summary: "Create a support ticket",
      scope: "tickets:write",
      body: ref("TicketCreate"),
      idempotent: true,
      response: "Ticket",
    },
  },
  "/tickets/{id}": {
    get: { summary: "Get a ticket by id or number", scope: "tickets:read", response: "Ticket" },
    patch: { summary: "Update ticket status, priority, assignee or resolution note", scope: "tickets:write" },
  },
  "/knowledge/documents": {
    get: { summary: "List knowledge documents", scope: "knowledge:read" },
    post: {
      summary:
        "Add a knowledge source: JSON {type:text|faq|url,...} or multipart/form-data with `file` (pdf, docx, txt, md, csv)",
      scope: "knowledge:write",
      body: ref("KnowledgeCreate"),
    },
  },
  "/knowledge/documents/{id}": {
    get: { summary: "Get a document including its extracted text", scope: "knowledge:read" },
    patch: {
      summary: "Update title/text/category (text changes trigger re-indexing)",
      scope: "knowledge:write",
    },
    delete: { summary: "Delete a document and its chunks", scope: "knowledge:write" },
  },
  "/knowledge/documents/{id}/reindex": { post: { summary: "Re-index a document", scope: "knowledge:write" } },
  "/knowledge/search": {
    post: {
      summary: "Test retrieval against the knowledge base",
      scope: "knowledge:read",
      body: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    },
  },
  "/tools": {
    get: { summary: "List built-in and HTTP integration tools", scope: "integrations:read" },
    post: {
      summary: "Register an HTTP integration tool",
      scope: "integrations:write",
      body: ref("HttpTool"),
    },
  },
  "/tools/{id}": {
    patch: { summary: "Enable/disable or update a tool", scope: "integrations:write" },
    delete: { summary: "Delete an HTTP tool", scope: "integrations:write" },
  },
  "/tools/executions": { get: { summary: "Tool execution log", scope: "integrations:read" } },
  "/followups": {
    get: { summary: "List follow-ups", scope: "followups:read" },
    post: {
      summary: "Schedule a follow-up (timezone-aware ISO time)",
      scope: "followups:write",
      body: ref("FollowUpCreate"),
      idempotent: true,
    },
  },
  "/followups/{id}": { delete: { summary: "Cancel a scheduled follow-up", scope: "followups:write" } },
  "/webhooks": {
    get: { summary: "List outbound webhook endpoints and available events", scope: "integrations:read" },
    post: {
      summary: "Register an outbound webhook (secret returned once)",
      scope: "integrations:write",
      body: {
        type: "object",
        properties: {
          url: { type: "string" },
          events: { type: "array", items: { type: "string", enum: [...WEBHOOK_EVENTS] } },
        },
        required: ["url", "events"],
      },
    },
  },
  "/webhooks/{id}": {
    patch: { summary: "Enable/disable or change events", scope: "integrations:write" },
    delete: { summary: "Delete endpoint", scope: "integrations:write" },
  },
  "/workflows/{name}": {
    post: {
      summary:
        "Trigger an authorized workflow: escalate-conversation | resolve-conversation | send-template | refresh-url-document",
      scope: "workflows:trigger",
      idempotent: true,
    },
  },
  "/simulator/{channelId}": {
    post: {
      summary: "Send a simulated customer message into a simulator channel",
      scope: "conversations:write",
      body: {
        type: "object",
        properties: { from: { type: "string" }, name: { type: "string" }, text: { type: "string" } },
        required: ["from", "name"],
      },
    },
    get: {
      summary: "Messages as seen on the simulated customer's phone",
      scope: "conversations:read",
      query: [["from", "string"]],
    },
  },
  "/channels/{id}/templates": {
    get: { summary: "List WhatsApp message templates for a channel", scope: "settings:read (session) " },
  },
  "/usage": { get: { summary: "AI token usage and estimated cost", scope: "usage:read" } },
  "/health": {
    get: {
      summary: "Detailed health: database, worker queue, dead letters, providers, channels",
      scope: "health:read",
    },
  },
};

export function buildOpenApi(appUrl: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const [path, ops] of Object.entries(PATHS)) {
    paths[path] = {};
    for (const [method, op] of Object.entries(ops)) {
      const params: unknown[] = [];
      for (const m of path.matchAll(/\{(\w+)\}/g))
        params.push({ name: m[1], in: "path", required: true, schema: { type: "string" } });
      for (const [name, type, description] of op.query ?? [])
        params.push({ name, in: "query", required: false, schema: { type }, description });
      if (op.idempotent)
        params.push({
          name: "Idempotency-Key",
          in: "header",
          required: false,
          schema: { type: "string", maxLength: 200 },
          description: "Replays the original response for retried requests (24h)",
        });
      paths[path]![method] = {
        summary: op.summary,
        description: op.scope ? `Required scope: \`${op.scope}\`` : undefined,
        parameters: params,
        ...(op.body
          ? { requestBody: { required: true, content: { "application/json": { schema: op.body } } } }
          : {}),
        responses: {
          "200": {
            description: "Success",
            ...(op.response ? { content: { "application/json": { schema: ref(op.response) } } } : {}),
          },
          "400": {
            description: "Validation error",
            content: { "application/json": { schema: ref("Error") } },
          },
          "401": { description: "Missing or invalid API key" },
          "403": { description: "API key lacks the required scope" },
          "404": { description: "Not found (or belongs to another organization)" },
          "429": { description: "Rate limited (see Retry-After)" },
        },
      };
    }
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "OpenWa Agent API",
      version: "1.0.0",
      description:
        "REST API for integrating with OpenWa Agent. Authenticate with `Authorization: Bearer owa_live_…` (API keys are created in the dashboard with scoped permissions). " +
        "All data is scoped to the organization that owns the key. Outbound webhooks are signed with `X-OpenWa-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + '.' + body)>`.",
      license: { name: "Apache-2.0", url: "https://www.apache.org/licenses/LICENSE-2.0" },
    },
    servers: [{ url: `${appUrl.replace(/\/$/, "")}/api/v1` }],
    security: [{ bearerAuth: [] }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", description: `Scopes: ${API_KEY_SCOPES.join(", ")}` },
      },
      schemas: {
        Error: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: { code: { type: "string" }, message: { type: "string" }, details: {} },
            },
            requestId: { type: "string" },
          },
        },
        Ticket: {
          type: "object",
          properties: {
            id: { type: "string" },
            number: { type: "integer" },
            subject: { type: "string" },
            description: { type: "string" },
            category: { type: "string" },
            priority: { type: "string", enum: ["LOW", "NORMAL", "HIGH", "URGENT"] },
            status: { type: "string", enum: ["OPEN", "IN_PROGRESS", "WAITING", "RESOLVED", "CLOSED"] },
            conversationId: { type: ["string", "null"] },
            customerId: { type: ["string", "null"] },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        TicketCreate: {
          type: "object",
          required: ["subject"],
          properties: {
            subject: { type: "string", minLength: 3, maxLength: 150 },
            description: { type: "string" },
            category: { type: "string" },
            priority: { type: "string", enum: ["LOW", "NORMAL", "HIGH", "URGENT"] },
            conversationId: { type: "string" },
            customerId: { type: "string" },
          },
        },
        KnowledgeCreate: {
          oneOf: [
            {
              type: "object",
              required: ["type", "title", "text"],
              properties: {
                type: { const: "text" },
                title: { type: "string" },
                text: { type: "string" },
                category: { type: "string" },
              },
            },
            {
              type: "object",
              required: ["type", "title", "items"],
              properties: {
                type: { const: "faq" },
                title: { type: "string" },
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: { question: { type: "string" }, answer: { type: "string" } },
                  },
                },
              },
            },
            {
              type: "object",
              required: ["type", "url"],
              properties: {
                type: { const: "url" },
                url: { type: "string", format: "uri" },
                title: { type: "string" },
              },
            },
          ],
        },
        HttpTool: {
          type: "object",
          required: ["name", "description", "permission", "config"],
          properties: {
            name: { type: "string", pattern: "^[a-z][a-z0-9_]{2,40}$" },
            description: { type: "string" },
            permission: { type: "string", enum: ["READ", "WRITE", "HIGH_IMPACT"] },
            requiresApproval: { type: "boolean" },
            timeoutMs: { type: "integer" },
            secret: {
              type: "string",
              description: "Value for authHeaderName; stored encrypted, never returned",
            },
            config: {
              type: "object",
              properties: {
                method: { type: "string", enum: ["GET", "POST"] },
                urlTemplate: { type: "string", example: "https://api.example.com/orders/{order_id}" },
                headers: { type: "object" },
                authHeaderName: { type: "string" },
                inputSchema: { type: "object" },
                responsePath: { type: "string" },
                customerIdParam: { type: "string" },
              },
            },
          },
        },
        FollowUpCreate: {
          type: "object",
          required: ["conversationId", "kind", "dueAt"],
          properties: {
            conversationId: { type: "string" },
            kind: { type: "string", enum: ["CHECK_IN", "REMINDER", "ESCALATION_REMINDER", "CASE_REVIEW"] },
            dueAt: { type: "string", format: "date-time" },
            timezone: { type: "string", example: "Africa/Nairobi" },
            message: { type: "string" },
            templateName: { type: "string" },
            templateLang: { type: "string" },
            reason: { type: "string" },
          },
        },
      },
    },
  };
}

export const OPENAPI_PATHS = Object.keys(PATHS);
