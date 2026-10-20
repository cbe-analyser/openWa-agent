"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { api, fetcher } from "@/lib/api";
import { customerName, timeAgo } from "@/lib/format";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Field,
  FormError,
  Input,
  PageHeader,
  Select,
  Spinner,
  Table,
  Td,
  Textarea,
  useAsyncAction,
} from "@/components/ui";
import { StatusBadge, UrgencyBadge } from "@/components/status";

interface T {
  id: string;
  number: number;
  subject: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  source: string;
  createdAt: string;
  conversationId: string | null;
  customer: { name: string | null; profileName: string | null; waId: string } | null;
  assignedTo: { name: string } | null;
}

const STATUSES = ["OPEN", "IN_PROGRESS", "WAITING", "RESOLVED", "CLOSED"];

export default function TicketsPage() {
  const [status, setStatus] = useState("");
  const { data, error, isLoading, mutate } = useSWR<{ items: T[] }>(
    `/api/v1/tickets?limit=100${status ? `&status=${status}` : ""}`,
    fetcher,
    { refreshInterval: 15000 },
  );
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ subject: "", description: "", priority: "NORMAL", category: "general" });
  const action = useAsyncAction();
  return (
    <>
      <PageHeader
        title="Support tickets"
        description="Cases created by the AI agent, your team or the API."
        actions={<Button onClick={() => setShow(!show)}>New ticket</Button>}
      />
      {show && (
        <Card title="New ticket" className="mb-4">
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await action.run(() => api("/api/v1/tickets", { body: form }))) {
                setShow(false);
                setForm({ subject: "", description: "", priority: "NORMAL", category: "general" });
                await mutate();
              }
            }}
          >
            <Field label="Subject" htmlFor="s">
              <Input
                id="s"
                required
                minLength={3}
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
              />
            </Field>
            <Field label="Priority" htmlFor="p">
              <Select
                id="p"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
              >
                {["LOW", "NORMAL", "HIGH", "URGENT"].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Description" htmlFor="d">
                <Textarea
                  id="d"
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </Field>
            </div>
            <FormError error={action.error} />
            <div>
              <Button type="submit" loading={action.pending}>
                Create
              </Button>
            </div>
          </form>
        </Card>
      )}
      <Card>
        <Select
          aria-label="Filter by status"
          className="mb-4 max-w-xs"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ").toLowerCase()}
            </option>
          ))}
        </Select>
        {isLoading && <Spinner />}
        {error && <ErrorState error={error} retry={() => mutate()} />}
        {data && (
          <Table
            head={["#", "Subject", "Customer", "Priority", "Status", "Source", "Created"]}
            empty={data.items.length === 0}
          >
            {data.items.map((t) => (
              <tr key={t.id}>
                <Td>{t.number}</Td>
                <Td>
                  <p className="font-medium">{t.subject}</p>
                  {t.description && <p className="line-clamp-2 text-xs text-slate-500">{t.description}</p>}
                  {t.conversationId && (
                    <Link className="text-xs underline" href={`/inbox/${t.conversationId}`}>
                      conversation
                    </Link>
                  )}
                </Td>
                <Td>{t.customer ? customerName(t.customer) : "—"}</Td>
                <Td>
                  <UrgencyBadge urgency={t.priority} />
                </Td>
                <Td>
                  <Select
                    aria-label={`Status of ticket ${t.number}`}
                    value={t.status}
                    className="min-w-36"
                    onChange={async (e) => {
                      let resolutionNote: string | undefined;
                      if (e.target.value === "RESOLVED")
                        resolutionNote = window.prompt("Resolution note") ?? undefined;
                      await action.run(() =>
                        api(`/api/v1/tickets/${t.id}`, {
                          method: "PATCH",
                          body: { status: e.target.value, ...(resolutionNote ? { resolutionNote } : {}) },
                        }),
                      );
                      await mutate();
                    }}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s.replace("_", " ").toLowerCase()}
                      </option>
                    ))}
                  </Select>
                  <span className="sr-only">
                    <StatusBadge status={t.status} />
                  </span>
                </Td>
                <Td>
                  <Badge tone={t.source === "AI" ? "purple" : "gray"}>{t.source.toLowerCase()}</Badge>
                </Td>
                <Td>{timeAgo(t.createdAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
