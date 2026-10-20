"use client";

import { useState } from "react";
import useSWR from "swr";
import { api, fetcher } from "@/lib/api";
import { dateTime, timeAgo } from "@/lib/format";
import { API_KEY_SCOPES } from "@/server/auth/permissions";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Field,
  FormError,
  Input,
  PageHeader,
  SecretReveal,
  Spinner,
  Table,
  Td,
  Toggle,
  useAsyncAction,
} from "@/components/ui";

interface Key {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}
interface Endpoint {
  id: string;
  url: string;
  description: string;
  events: string[];
  enabled: boolean;
  lastDeliveryAt: string | null;
  failureCount: number;
}

export default function DeveloperPage() {
  return (
    <>
      <PageHeader
        title="Developer API"
        description={
          <>
            REST API under <code>/api/v1</code>, authenticated with{" "}
            <code>Authorization: Bearer owa_live_…</code>. See the{" "}
            <a className="underline" href="/api/v1/openapi.json" target="_blank" rel="noreferrer">
              OpenAPI specification
            </a>
            .
          </>
        }
      />
      <ApiKeys />
      <Webhooks />
    </>
  );
}

function ApiKeys() {
  const { data, error, isLoading, mutate } = useSWR<{ items: Key[] }>("/api/v1/api-keys", fetcher);
  const [f, setF] = useState({ name: "", scopes: ["conversations:read"] as string[], expiresInDays: "90" });
  const [secret, setSecret] = useState<string | null>(null);
  const action = useAsyncAction();
  return (
    <Card title="API keys">
      {secret && (
        <div className="mb-4">
          <SecretReveal label="Your new API key" value={secret} onDone={() => setSecret(null)} />
        </div>
      )}
      <form
        className="mb-4 space-y-3 rounded border border-slate-200 p-3 dark:border-slate-700"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await action.run(() =>
            api<{ key: string }>("/api/v1/api-keys", {
              body: {
                name: f.name,
                scopes: f.scopes,
                expiresInDays: f.expiresInDays ? Number(f.expiresInDays) : null,
              },
            }),
          );
          if (r) {
            setSecret(r.key);
            setF({ ...f, name: "" });
            await mutate();
          }
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Key name" htmlFor="kn">
            <Input
              id="kn"
              required
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
              placeholder="e.g. CRM sync"
            />
          </Field>
          <Field label="Expires after (days)" htmlFor="kd" hint="Empty for no expiry (not recommended).">
            <Input
              id="kd"
              type="number"
              min={1}
              max={730}
              value={f.expiresInDays}
              onChange={(e) => setF({ ...f, expiresInDays: e.target.value })}
            />
          </Field>
        </div>
        <fieldset>
          <legend className="mb-1 text-sm font-medium">Scopes (grant only what the integration needs)</legend>
          <div className="flex flex-wrap gap-2">
            {API_KEY_SCOPES.map((s) => (
              <label
                key={s}
                className="flex items-center gap-1 rounded border border-slate-200 px-2 py-1 font-mono text-xs dark:border-slate-700"
              >
                <input
                  type="checkbox"
                  checked={f.scopes.includes(s)}
                  onChange={() =>
                    setF({
                      ...f,
                      scopes: f.scopes.includes(s) ? f.scopes.filter((x) => x !== s) : [...f.scopes, s],
                    })
                  }
                />
                {s}
              </label>
            ))}
          </div>
        </fieldset>
        <FormError error={action.error} />
        <Button type="submit" loading={action.pending}>
          Create key
        </Button>
      </form>
      {isLoading && <Spinner />}
      {error && <ErrorState error={error} retry={() => mutate()} />}
      {data && (
        <Table head={["Name", "Key", "Scopes", "Last used", "Expires", ""]} empty={data.items.length === 0}>
          {data.items.map((k) => {
            const expired = k.expiresAt && new Date(k.expiresAt) < new Date();
            return (
              <tr key={k.id}>
                <Td>
                  {k.name}{" "}
                  {k.revokedAt ? (
                    <Badge tone="red">revoked</Badge>
                  ) : expired ? (
                    <Badge tone="yellow">expired</Badge>
                  ) : (
                    <Badge tone="green">active</Badge>
                  )}
                </Td>
                <Td className="font-mono text-xs">{k.prefix}…</Td>
                <Td className="max-w-xs text-xs">{k.scopes.join(", ")}</Td>
                <Td>{timeAgo(k.lastUsedAt)}</Td>
                <Td>{k.expiresAt ? dateTime(k.expiresAt) : "never"}</Td>
                <Td>
                  {!k.revokedAt && (
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={async () => {
                          const grace = window.prompt(
                            "Rotate key: keep the old key working for how many days? (0 revokes it now)",
                            "0",
                          );
                          if (grace === null) return;
                          const r = await action.run(() =>
                            api<{ key: string }>(`/api/v1/api-keys/${k.id}/rotate`, {
                              body: { graceDays: Math.max(0, Math.min(30, Number(grace) || 0)) },
                            }),
                          );
                          if (r) setSecret(r.key);
                          await mutate();
                        }}
                      >
                        Rotate
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={async () => {
                          if (
                            !window.confirm(
                              `Revoke "${k.name}"? Integrations using it stop working immediately.`,
                            )
                          )
                            return;
                          await action.run(() => api(`/api/v1/api-keys/${k.id}`, { method: "DELETE" }));
                          await mutate();
                        }}
                      >
                        Revoke
                      </Button>
                    </div>
                  )}
                </Td>
              </tr>
            );
          })}
        </Table>
      )}
    </Card>
  );
}

function Webhooks() {
  const { data, error, isLoading, mutate } = useSWR<{ items: Endpoint[]; events: string[] }>(
    "/api/v1/webhooks",
    fetcher,
  );
  const [f, setF] = useState({ url: "", description: "", events: ["conversation.escalated"] as string[] });
  const [secret, setSecret] = useState<string | null>(null);
  const action = useAsyncAction();
  return (
    <Card title="Outgoing webhooks" className="mt-4">
      <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
        Each delivery is a JSON POST with an <code>X-OpenWa-Signature: t=&lt;unix&gt;,v1=&lt;hex&gt;</code>{" "}
        header: HMAC-SHA256 of <code>t.body</code> with your signing secret. Reject timestamps older than 5
        minutes. Deliveries are retried with backoff.
      </p>
      {secret && (
        <div className="mb-4">
          <SecretReveal
            label="Signing secret for the new endpoint"
            value={secret}
            onDone={() => setSecret(null)}
          />
        </div>
      )}
      <form
        className="mb-4 space-y-3 rounded border border-slate-200 p-3 dark:border-slate-700"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await action.run(() => api<{ secret: string }>("/api/v1/webhooks", { body: f }));
          if (r) {
            setSecret(r.secret);
            setF({ ...f, url: "", description: "" });
            await mutate();
          }
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Endpoint URL (HTTPS)">
            <Input type="url" required value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />
          </Field>
          <Field label="Description">
            <Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          </Field>
        </div>
        <fieldset>
          <legend className="mb-1 text-sm font-medium">Events</legend>
          <div className="flex flex-wrap gap-2">
            {(data?.events ?? []).map((ev) => (
              <label
                key={ev}
                className="flex items-center gap-1 rounded border border-slate-200 px-2 py-1 font-mono text-xs dark:border-slate-700"
              >
                <input
                  type="checkbox"
                  checked={f.events.includes(ev)}
                  onChange={() =>
                    setF({
                      ...f,
                      events: f.events.includes(ev) ? f.events.filter((x) => x !== ev) : [...f.events, ev],
                    })
                  }
                />
                {ev}
              </label>
            ))}
          </div>
        </fieldset>
        <FormError error={action.error} />
        <Button type="submit" loading={action.pending}>
          Add endpoint
        </Button>
      </form>
      {isLoading && <Spinner />}
      {error && <ErrorState error={error} retry={() => mutate()} />}
      {data && (
        <Table
          head={["URL", "Events", "Last delivery", "Failures", "Enabled", ""]}
          empty={data.items.length === 0}
        >
          {data.items.map((w) => (
            <tr key={w.id}>
              <Td className="max-w-xs break-all text-xs">
                {w.url}
                {w.description && <p className="text-slate-500">{w.description}</p>}
              </Td>
              <Td className="text-xs">{w.events.join(", ")}</Td>
              <Td>{timeAgo(w.lastDeliveryAt)}</Td>
              <Td>{w.failureCount}</Td>
              <Td>
                <Toggle
                  label="Enabled"
                  checked={w.enabled}
                  onChange={async (v) => (
                    await action.run(() =>
                      api(`/api/v1/webhooks/${w.id}`, { method: "PATCH", body: { enabled: v } }),
                    ),
                    await mutate()
                  )}
                />
              </Td>
              <Td>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={async () => {
                    if (!window.confirm("Delete this endpoint?")) return;
                    await action.run(() => api(`/api/v1/webhooks/${w.id}`, { method: "DELETE" }));
                    await mutate();
                  }}
                >
                  Delete
                </Button>
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}
