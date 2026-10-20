"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { api, fetcher } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Field,
  FormError,
  Input,
  Notice,
  PageHeader,
  Select,
  Spinner,
  Table,
  Td,
  Textarea,
  Toggle,
  useAsyncAction,
} from "@/components/ui";

interface Tool {
  id: string;
  name: string;
  kind: "BUILTIN" | "HTTP";
  description: string;
  enabled: boolean;
  permission: "READ" | "WRITE" | "HIGH_IMPACT";
  requiresApproval: boolean;
  timeoutMs: number;
  config: Record<string, unknown>;
  hasSecret: boolean;
}

interface Execution {
  id: string;
  toolName: string;
  status: string;
  input: unknown;
  output: unknown;
  error: string | null;
  durationMs: number | null;
  conversationId: string | null;
  createdAt: string;
}

const PERM_TONE = { READ: "gray", WRITE: "blue", HIGH_IMPACT: "red" } as const;
const EXEC_TONE: Record<string, "green" | "red" | "yellow" | "gray" | "blue"> = {
  SUCCEEDED: "green",
  FAILED: "red",
  DENIED: "red",
  PENDING_APPROVAL: "yellow",
  APPROVED: "blue",
  REJECTED: "gray",
};

const EXAMPLE_SCHEMA = JSON.stringify(
  {
    type: "object",
    properties: { order_id: { type: "string", description: "Order number", maxLength: 40 } },
    required: ["order_id"],
  },
  null,
  2,
);

export default function ToolsPage() {
  const tools = useSWR<{ items: Tool[] }>("/api/v1/tools", fetcher);
  const [editing, setEditing] = useState<Tool | "new" | null>(null);
  const action = useAsyncAction();

  return (
    <>
      <PageHeader
        title="Tools & integrations"
        description="Actions the agent may take. Every call is validated against a schema, logged, and limited by permission level. The agent cannot run shell commands or arbitrary code."
        actions={<Button onClick={() => setEditing("new")}>Add HTTP tool</Button>}
      />
      {editing && (
        <HttpToolForm
          key={editing === "new" ? "new" : editing.id}
          tool={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await tools.mutate();
          }}
        />
      )}
      <Card title="Registered tools">
        {tools.isLoading && <Spinner />}
        {tools.error && <ErrorState error={tools.error} retry={() => tools.mutate()} />}
        {tools.data && (
          <Table
            head={["Tool", "Permission", "Approval", "Enabled", ""]}
            empty={tools.data.items.length === 0}
          >
            {tools.data.items.map((t) => (
              <tr key={t.id}>
                <Td>
                  <p className="font-mono text-sm font-medium">{t.name}</p>
                  <p className="text-xs text-slate-500">{t.description}</p>
                  <Badge tone={t.kind === "BUILTIN" ? "purple" : "gray"}>
                    {t.kind === "BUILTIN" ? "built-in" : "HTTP"}
                  </Badge>
                </Td>
                <Td>
                  <Badge tone={PERM_TONE[t.permission]}>{t.permission.replace("_", " ").toLowerCase()}</Badge>
                </Td>
                <Td>
                  <Toggle
                    label="Needs approval"
                    checked={t.requiresApproval || t.permission === "HIGH_IMPACT"}
                    disabled={t.permission === "HIGH_IMPACT"}
                    onChange={async (v) => (
                      await action.run(() =>
                        api(`/api/v1/tools/${t.id}`, { method: "PATCH", body: { requiresApproval: v } }),
                      ),
                      await tools.mutate()
                    )}
                  />
                </Td>
                <Td>
                  <Toggle
                    label="Enabled"
                    checked={t.enabled}
                    onChange={async (v) => (
                      await action.run(() =>
                        api(`/api/v1/tools/${t.id}`, { method: "PATCH", body: { enabled: v } }),
                      ),
                      await tools.mutate()
                    )}
                  />
                </Td>
                <Td>
                  {t.kind === "HTTP" && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="secondary" onClick={() => setEditing(t)}>
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={async () => {
                          if (!window.confirm(`Delete tool ${t.name}?`)) return;
                          await action.run(() => api(`/api/v1/tools/${t.id}`, { method: "DELETE" }));
                          await tools.mutate();
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
        <FormError error={action.error} />
      </Card>
      <Executions />
    </>
  );
}

function HttpToolForm({ tool, onClose, onSaved }: { tool?: Tool; onClose: () => void; onSaved: () => void }) {
  const cfg = (tool?.config ?? {}) as {
    method?: string;
    urlTemplate?: string;
    headers?: Record<string, string>;
    authHeaderName?: string;
    inputSchema?: unknown;
    responsePath?: string;
    customerIdParam?: string;
  };
  const [f, setF] = useState({
    name: tool?.name ?? "",
    description: tool?.description ?? "",
    permission: tool?.permission ?? "READ",
    requiresApproval: tool?.requiresApproval ?? false,
    timeoutMs: tool?.timeoutMs ?? 10000,
    method: cfg.method ?? "GET",
    urlTemplate: cfg.urlTemplate ?? "",
    headers: JSON.stringify(cfg.headers ?? {}, null, 2),
    authHeaderName: cfg.authHeaderName ?? "",
    inputSchema: cfg.inputSchema ? JSON.stringify(cfg.inputSchema, null, 2) : EXAMPLE_SCHEMA,
    responsePath: cfg.responsePath ?? "",
    customerIdParam: cfg.customerIdParam ?? "",
    secret: "",
  });
  const action = useAsyncAction();
  return (
    <Card title={tool ? `Edit ${tool.name}` : "New HTTP tool"} className="mb-4">
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          let headers: unknown, inputSchema: unknown;
          try {
            headers = JSON.parse(f.headers || "{}");
            inputSchema = JSON.parse(f.inputSchema);
          } catch {
            action.setError("Headers and input schema must be valid JSON");
            return;
          }
          const config = {
            method: f.method,
            urlTemplate: f.urlTemplate,
            headers,
            inputSchema,
            ...(f.authHeaderName ? { authHeaderName: f.authHeaderName } : {}),
            ...(f.responsePath ? { responsePath: f.responsePath } : {}),
            ...(f.customerIdParam ? { customerIdParam: f.customerIdParam } : {}),
          };
          const body = {
            description: f.description,
            permission: f.permission,
            requiresApproval: f.requiresApproval,
            timeoutMs: Number(f.timeoutMs),
            config,
            ...(f.secret ? { secret: f.secret } : {}),
          };
          const ok = await action.run(() =>
            tool
              ? api(`/api/v1/tools/${tool.id}`, { method: "PATCH", body })
              : api("/api/v1/tools", { body: { name: f.name, ...body } }),
          );
          if (ok) onSaved();
        }}
      >
        <Notice tone="blue">
          The agent fills in the inputs you define; the server makes the request. Only public HTTPS hosts are
          allowed, responses are size-limited, and the secret is encrypted and never shown to the AI.
        </Notice>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor="tn" hint="Lowercase, e.g. check_order">
            <Input
              id="tn"
              required
              disabled={!!tool}
              pattern="[a-z][a-z0-9_]{2,40}"
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
            />
          </Field>
          <Field
            label="Permission level"
            htmlFor="tp"
            hint="High-impact tools always need a person to approve each call."
          >
            <Select
              id="tp"
              value={f.permission}
              onChange={(e) => setF({ ...f, permission: e.target.value as Tool["permission"] })}
            >
              <option value="READ">Read (look up data)</option>
              <option value="WRITE">Write (changes data)</option>
              <option value="HIGH_IMPACT">High impact (refunds, cancellations…)</option>
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field
              label="Description for the AI"
              htmlFor="td"
              hint="Say exactly when to use it and what it returns."
            >
              <Textarea
                id="td"
                rows={2}
                required
                minLength={10}
                value={f.description}
                onChange={(e) => setF({ ...f, description: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Method">
            <Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
              <option>GET</option>
              <option>POST</option>
            </Select>
          </Field>
          <Field label="URL template" hint="Use {input_name} placeholders.">
            <Input
              type="url"
              required
              value={f.urlTemplate}
              onChange={(e) => setF({ ...f, urlTemplate: e.target.value })}
              placeholder="https://api.example.com/orders/{order_id}"
            />
          </Field>
          <Field label="Auth header name (optional)" hint="e.g. Authorization">
            <Input
              value={f.authHeaderName}
              onChange={(e) => setF({ ...f, authHeaderName: e.target.value })}
            />
          </Field>
          <Field
            label="Auth header value (secret)"
            hint={
              tool?.hasSecret ? "Stored. Leave empty to keep it." : "e.g. Bearer sk_… — stored encrypted."
            }
          >
            <Input
              type="password"
              autoComplete="off"
              value={f.secret}
              onChange={(e) => setF({ ...f, secret: e.target.value })}
            />
          </Field>
          <Field
            label="Response path (optional)"
            hint="Dot path of the JSON returned to the AI, e.g. data.order"
          >
            <Input value={f.responsePath} onChange={(e) => setF({ ...f, responsePath: e.target.value })} />
          </Field>
          <Field
            label="Customer phone parameter (optional)"
            hint="Adds the verified WhatsApp number server-side; the AI cannot change it."
          >
            <Input
              value={f.customerIdParam}
              onChange={(e) => setF({ ...f, customerIdParam: e.target.value })}
            />
          </Field>
          <Field label="Timeout (ms)">
            <Input
              type="number"
              min={1000}
              max={30000}
              value={f.timeoutMs}
              onChange={(e) => setF({ ...f, timeoutMs: Number(e.target.value) })}
            />
          </Field>
          <div className="flex items-end">
            <Toggle
              label="Require approval for every call"
              checked={f.requiresApproval || f.permission === "HIGH_IMPACT"}
              disabled={f.permission === "HIGH_IMPACT"}
              onChange={(v) => setF({ ...f, requiresApproval: v })}
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Input schema (JSON Schema subset)">
            <Textarea
              rows={8}
              className="font-mono text-xs"
              value={f.inputSchema}
              onChange={(e) => setF({ ...f, inputSchema: e.target.value })}
            />
          </Field>
          <Field label="Static headers (JSON)">
            <Textarea
              rows={8}
              className="font-mono text-xs"
              value={f.headers}
              onChange={(e) => setF({ ...f, headers: e.target.value })}
            />
          </Field>
        </div>
        <FormError error={action.error} />
        <div className="flex gap-2">
          <Button type="submit" loading={action.pending}>
            Save tool
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Executions() {
  const [status, setStatus] = useState("");
  const { data, error, isLoading, mutate } = useSWR<{ items: Execution[] }>(
    `/api/v1/tools/executions?limit=100${status ? `&status=${status}` : ""}`,
    fetcher,
    { refreshInterval: 10000 },
  );
  const action = useAsyncAction();
  return (
    <Card
      title="Tool calls"
      className="mt-4"
      actions={
        <Select
          aria-label="Filter tool calls"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="max-w-48"
        >
          <option value="">All</option>
          {Object.keys(EXEC_TONE).map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ").toLowerCase()}
            </option>
          ))}
        </Select>
      }
    >
      {isLoading && <Spinner />}
      {error && <ErrorState error={error} retry={() => mutate()} />}
      {data && (
        <Table head={["When", "Tool", "Status", "Input / result", ""]} empty={data.items.length === 0}>
          {data.items.map((x) => (
            <tr key={x.id}>
              <Td>{timeAgo(x.createdAt)}</Td>
              <Td>
                <span className="font-mono text-xs">{x.toolName}</span>
                {x.conversationId && (
                  <Link href={`/inbox/${x.conversationId}`} className="block text-xs underline">
                    conversation
                  </Link>
                )}
              </Td>
              <Td>
                <Badge tone={EXEC_TONE[x.status] ?? "gray"}>{x.status.replace("_", " ").toLowerCase()}</Badge>
                {x.durationMs !== null && (
                  <span className="ml-1 text-xs text-slate-500">{x.durationMs} ms</span>
                )}
              </Td>
              <Td className="max-w-md">
                <pre className="max-h-24 overflow-auto text-xs whitespace-pre-wrap">
                  {JSON.stringify(x.input)}
                </pre>
                {x.error && <p className="text-xs text-red-600">{x.error}</p>}
                {x.output !== null && x.output !== undefined && (
                  <pre className="max-h-24 overflow-auto text-xs whitespace-pre-wrap text-slate-500">
                    {JSON.stringify(x.output)}
                  </pre>
                )}
              </Td>
              <Td>
                {x.status === "PENDING_APPROVAL" && (
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      onClick={async () => (
                        await action.run(() =>
                          api(`/api/v1/tools/executions/${x.id}`, { body: { approve: true } }),
                        ),
                        await mutate()
                      )}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={async () => (
                        await action.run(() =>
                          api(`/api/v1/tools/executions/${x.id}`, { body: { approve: false } }),
                        ),
                        await mutate()
                      )}
                    >
                      Reject
                    </Button>
                  </div>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}
      <FormError error={action.error} />
    </Card>
  );
}
