"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/api";
import { customerName, timeAgo } from "@/lib/format";
import { Badge, Card, EmptyState, ErrorState, Input, PageHeader, Select, Spinner } from "@/components/ui";
import { ControlBadge, StatusBadge, UrgencyBadge } from "@/components/status";

interface Row {
  id: string;
  status: string;
  control: string;
  aiPaused: boolean;
  intent: string | null;
  urgency: string;
  unreadCount: number;
  lastMessageAt: string;
  tags: string[];
  customer: { name: string | null; profileName: string | null; waId: string; optedOut: boolean };
  assignedTo: { name: string } | null;
  channel: { name: string; kind: string };
  messages: Array<{ body: string | null; direction: string; status: string; type: string }>;
}

export default function InboxPage() {
  const [status, setStatus] = useState("");
  const [control, setControl] = useState("");
  const [q, setQ] = useState("");
  const [unread, setUnread] = useState(false);
  const params = new URLSearchParams({
    ...(status && { status }),
    ...(control && { control }),
    ...(q && { q }),
    ...(unread && { unread: "true" }),
    limit: "50",
  });
  const { data, error, isLoading, mutate } = useSWR<{ items: Row[] }>(
    `/api/v1/conversations?${params}`,
    fetcher,
    { refreshInterval: 5000, keepPreviousData: true },
  );

  return (
    <>
      <PageHeader
        title="Inbox"
        description="All customer conversations. Open one to read, take over, approve drafts or reply."
      />
      <Card>
        <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <Input
            aria-label="Search"
            placeholder="Search name, number or text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="lg:col-span-2"
          />
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="OPEN">Open</option>
            <option value="PENDING">Pending</option>
            <option value="ESCALATED">Escalated</option>
            <option value="RESOLVED">Resolved</option>
          </Select>
          <Select aria-label="Control" value={control} onChange={(e) => setControl(e.target.value)}>
            <option value="">Anyone handling</option>
            <option value="AI">AI-controlled</option>
            <option value="PENDING_HUMAN">Waiting for human</option>
            <option value="HUMAN">Human-controlled</option>
          </Select>
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={unread}
              onChange={(e) => setUnread(e.target.checked)}
              className="h-4 w-4"
            />{" "}
            Unread only
          </label>
        </div>
        {isLoading && !data && <Spinner />}
        {error && <ErrorState error={error} retry={() => mutate()} />}
        {data && data.items.length === 0 && (
          <EmptyState
            title="No conversations"
            description={
              <>
                Messages appear here when customers write to a connected number. Try the{" "}
                <Link className="underline" href="/simulator">
                  simulator
                </Link>
                .
              </>
            }
          />
        )}
        {data && data.items.length > 0 && (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.items.map((c) => {
              const last = c.messages[0];
              return (
                <li key={c.id}>
                  <Link
                    href={`/inbox/${c.id}`}
                    className="flex flex-col gap-1 rounded-lg px-2 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 sm:flex-row sm:items-center sm:gap-4"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{customerName(c.customer)}</span>
                        {c.unreadCount > 0 && <Badge tone="green">{c.unreadCount} new</Badge>}
                        {c.customer.optedOut && <Badge tone="red">opted out</Badge>}
                        {c.tags.includes("spam") && <Badge>spam</Badge>}
                      </div>
                      <p className="truncate text-sm text-slate-500">
                        {last
                          ? `${last.direction === "OUTBOUND" ? "You: " : ""}${last.body ?? `[${last.type}]`}`
                          : "No messages"}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <ControlBadge control={c.control} aiPaused={c.aiPaused} />
                      <StatusBadge status={c.status} />
                      {c.intent && <Badge>{c.intent.replace(/_/g, " ")}</Badge>}
                      {(c.urgency === "HIGH" || c.urgency === "URGENT") && (
                        <UrgencyBadge urgency={c.urgency} />
                      )}
                      <span className="text-slate-500">{timeAgo(c.lastMessageAt)}</span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
