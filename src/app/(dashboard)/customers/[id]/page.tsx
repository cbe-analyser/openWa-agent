"use client";

import Link from "next/link";
import { use, useState } from "react";
import useSWR from "swr";
import { api, fetcher } from "@/lib/api";
import { customerName, dateTime, timeAgo } from "@/lib/format";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Field,
  FormError,
  Input,
  PageHeader,
  Spinner,
  Toggle,
  useAsyncAction,
} from "@/components/ui";
import { ControlBadge, StatusBadge } from "@/components/status";

interface CustomerDetail {
  id: string;
  name: string | null;
  profileName: string | null;
  waId: string;
  email: string | null;
  tags: string[];
  optedOut: boolean;
  optedOutAt: string | null;
  createdAt: string;
  conversations: Array<{
    id: string;
    status: string;
    control: string;
    lastMessageAt: string;
    channel: { name: string };
  }>;
  tickets: Array<{ id: string; number: number; subject: string; status: string; createdAt: string }>;
  timeline: Array<{
    id: string;
    direction: string;
    authorType: string;
    body: string | null;
    type: string;
    status: string;
    createdAt: string;
    conversationId: string;
  }>;
}

export default function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, isLoading, mutate } = useSWR<CustomerDetail>(`/api/v1/customers/${id}`, fetcher);
  // Unsaved edits; until the first edit the form shows the stored values.
  const [draft, setForm] = useState<{ name: string; email: string; tags: string } | null>(null);
  const save = useAsyncAction();
  if (isLoading) return <Spinner />;
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return null;
  const form = draft ?? { name: data.name ?? "", email: data.email ?? "", tags: data.tags.join(", ") };
  return (
    <>
      <PageHeader
        title={customerName(data)}
        description={`+${data.waId} · customer since ${dateTime(data.createdAt)}`}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <Card title="Profile">
            <form
              className="space-y-3"
              onSubmit={async (e) => {
                e.preventDefault();
                const updated = await save.run(() =>
                  api(`/api/v1/customers/${id}`, {
                    method: "PATCH",
                    body: {
                      name: form.name || null,
                      email: form.email || null,
                      tags: form.tags
                        .split(",")
                        .map((t) => t.trim())
                        .filter(Boolean),
                    },
                  }),
                );
                if (updated === undefined) return; // keep the edits; the error is shown
                await mutate();
                setForm(null);
              }}
            >
              <Field label="Name" htmlFor="n">
                <Input
                  id="n"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={data.profileName ?? ""}
                />
              </Field>
              <Field label="Email" htmlFor="e">
                <Input
                  id="e"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </Field>
              <Field label="Tags" htmlFor="t" hint="Comma-separated">
                <Input
                  id="t"
                  value={form.tags}
                  onChange={(e) => setForm({ ...form, tags: e.target.value })}
                />
              </Field>
              <FormError error={save.error} />
              <Button type="submit" loading={save.pending}>
                Save
              </Button>
            </form>
          </Card>
          <Card title="Consent">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span>{data.optedOut ? `Opted out ${timeAgo(data.optedOutAt)}` : "Can receive messages"}</span>
              <Toggle
                label="Opted out"
                checked={data.optedOut}
                onChange={async (v) => {
                  await save.run(() =>
                    api(`/api/v1/customers/${id}`, { method: "PATCH", body: { optedOut: v } }),
                  );
                  await mutate();
                }}
              />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Opting a customer out cancels pending follow-ups and blocks all outbound messages.
            </p>
          </Card>
          <Card title="Data rights">
            <div className="flex flex-wrap gap-2">
              <a
                className="inline-flex min-h-10 items-center rounded-lg border border-slate-300 px-4 text-sm dark:border-slate-700"
                href={`/api/v1/customers/${id}/export`}
              >
                Export data
              </a>
              <Button
                variant="danger"
                onClick={async () => {
                  if (
                    !window.confirm(
                      "Permanently delete this customer and all their conversations, messages, tickets and follow-ups?",
                    )
                  )
                    return;
                  if (await save.run(() => api(`/api/v1/customers/${id}`, { method: "DELETE" })))
                    window.location.href = "/customers";
                }}
              >
                Delete all data
              </Button>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Deletion requires the owner role and is recorded in the audit log.
            </p>
          </Card>
        </div>
        <div className="space-y-4 lg:col-span-2">
          <Card title="Conversations">
            <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
              {data.conversations.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <Link className="underline" href={`/inbox/${c.id}`}>
                    {c.channel.name}
                  </Link>
                  <span className="flex items-center gap-2">
                    <ControlBadge control={c.control} />
                    <StatusBadge status={c.status} />{" "}
                    <span className="text-xs text-slate-500">{timeAgo(c.lastMessageAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Tickets">
            {data.tickets.length === 0 ? (
              <p className="text-sm text-slate-500">No tickets.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {data.tickets.map((t) => (
                  <li key={t.id} className="flex items-center justify-between">
                    <span>
                      #{t.number} {t.subject}
                    </span>
                    <StatusBadge status={t.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Interaction timeline">
            <ol className="space-y-2 text-sm">
              {data.timeline.map((m) => (
                <li key={m.id} className="flex gap-3">
                  <span className="w-28 shrink-0 text-xs text-slate-500">{dateTime(m.createdAt)}</span>
                  <span className="min-w-0">
                    <Badge
                      tone={m.direction === "INBOUND" ? "gray" : m.authorType === "AI" ? "purple" : "green"}
                    >
                      {m.direction === "INBOUND" ? "customer" : m.authorType.toLowerCase()}
                    </Badge>{" "}
                    <span className="prose-chat">{m.body ?? `[${m.type}]`}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
