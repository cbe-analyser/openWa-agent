"use client";

import Link from "next/link";
import useSWR from "swr";
import { fetcher } from "@/lib/api";
import { formatDuration, num, pct, timeAgo, usd } from "@/lib/format";
import { Badge, Card, EmptyState, ErrorState, Notice, PageHeader, Spinner, Stat } from "@/components/ui";
import { StatusBadge } from "@/components/status";

interface Overview {
  periodDays: number;
  totalConversations: number;
  activeConversations: number;
  incomingMessages: number;
  aiHandledConversations: number;
  humanHandledConversations: number;
  escalatedOpen: number;
  escalationRate: number | null;
  resolvedConversations: number;
  resolutionRate: number | null;
  avgFirstResponseSeconds: number | null;
  responseSamples: number;
  failedMessages: number;
  pendingTickets: number;
  pendingApprovals: number;
  estimatedAiCostUsd: number;
  providers: Array<{
    id: string;
    name: string;
    kind: string;
    model: string;
    enabled: boolean;
    isPrimary: boolean;
    lastHealthStatus: string | null;
    lastHealthAt: string | null;
  }>;
  channels: Array<{
    id: string;
    name: string;
    kind: string;
    status: string;
    lastWebhookAt: string | null;
    lastError: string | null;
  }>;
  aiPaused: boolean;
  autonomyMode: string;
  globalKillSwitch: boolean;
}

export default function OverviewPage() {
  const { data, error, isLoading, mutate } = useSWR<Overview>("/api/v1/overview?days=30", fetcher, {
    refreshInterval: 30_000,
  });
  return (
    <>
      <PageHeader
        title="Overview"
        description="Last 30 days, computed from your stored conversations and usage records."
      />
      {isLoading && <Spinner />}
      {error && <ErrorState error={error} retry={() => mutate()} />}
      {data && (
        <div className="space-y-5">
          {data.providers.length === 0 && (
            <Notice tone="yellow">
              No AI provider is configured yet, so incoming messages are escalated to your team.{" "}
              <Link className="underline" href="/agent">
                Add a provider
              </Link>{" "}
              or follow the{" "}
              <Link className="underline" href="/setup">
                setup guide
              </Link>
              .
            </Notice>
          )}
          {data.channels.length === 0 && (
            <Notice tone="blue">
              No messaging channel yet.{" "}
              <Link className="underline" href="/connections">
                Connect WhatsApp
              </Link>{" "}
              or create a simulator channel to test without credentials.
            </Notice>
          )}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat
              label="Total conversations"
              value={num(data.totalConversations)}
              hint={`${num(data.activeConversations)} active in period`}
            />
            <Stat label="Incoming messages" value={num(data.incomingMessages)} />
            <Stat
              label="AI-handled"
              value={num(data.aiHandledConversations)}
              hint="active conversations under AI control"
            />
            <Stat
              label="Human-handled"
              value={num(data.humanHandledConversations)}
              hint="taken over or waiting for a human"
            />
            <Stat
              label="Escalation rate"
              value={pct(data.escalationRate)}
              hint={`${num(data.escalatedOpen)} currently escalated`}
              tone={data.escalatedOpen > 0 ? "warn" : undefined}
            />
            <Stat
              label="Resolution rate"
              value={pct(data.resolutionRate)}
              hint={`${num(data.resolvedConversations)} resolved`}
            />
            <Stat
              label="Avg. first response"
              value={
                data.avgFirstResponseSeconds === null ? "—" : formatDuration(data.avgFirstResponseSeconds)
              }
              hint={data.responseSamples ? `${data.responseSamples} replies measured` : "no replies yet"}
            />
            <Stat
              label="Failed messages"
              value={num(data.failedMessages)}
              tone={data.failedMessages > 0 ? "bad" : undefined}
            />
            <Stat
              label="Pending support cases"
              value={num(data.pendingTickets)}
              hint="open, in progress or waiting"
            />
            <Stat
              label="Drafts awaiting approval"
              value={num(data.pendingApprovals)}
              tone={data.pendingApprovals > 0 ? "warn" : undefined}
            />
            <Stat
              label="Estimated AI cost"
              value={usd(data.estimatedAiCostUsd)}
              hint="from provider token counts"
            />
            <Stat
              label="Autonomy mode"
              value={<span className="text-lg">{data.autonomyMode.toLowerCase()}</span>}
              hint={data.aiPaused || data.globalKillSwitch ? "AI replies paused" : "AI replies active"}
            />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card
              title="AI provider health"
              actions={
                <Link className="text-sm text-brand-700 underline dark:text-brand-500" href="/agent">
                  Manage
                </Link>
              }
            >
              {data.providers.length === 0 ? (
                <EmptyState title="No AI providers" />
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.providers.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                      <span>
                        {p.name} <span className="text-slate-500">· {p.model}</span>{" "}
                        {p.isPrimary && <Badge tone="blue">primary</Badge>}{" "}
                        {!p.enabled && <Badge>disabled</Badge>}
                      </span>
                      <span className="flex items-center gap-2 text-xs text-slate-500">
                        {p.lastHealthStatus ? (
                          <StatusBadge status={p.lastHealthStatus} />
                        ) : (
                          <Badge>not checked</Badge>
                        )}{" "}
                        {p.lastHealthAt && timeAgo(p.lastHealthAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card
              title="WhatsApp connection health"
              actions={
                <Link className="text-sm text-brand-700 underline dark:text-brand-500" href="/connections">
                  Manage
                </Link>
              }
            >
              {data.channels.length === 0 ? (
                <EmptyState title="No channels" />
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.channels.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                      <span>
                        {c.name}{" "}
                        <span className="text-slate-500">
                          · {c.kind === "SIMULATOR" ? "simulator" : "Cloud API"}
                        </span>
                      </span>
                      <span className="flex items-center gap-2 text-xs text-slate-500">
                        <StatusBadge status={c.status} /> last webhook {timeAgo(c.lastWebhookAt)}
                      </span>
                      {c.lastError && <p className="w-full text-xs text-red-600">{c.lastError}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
