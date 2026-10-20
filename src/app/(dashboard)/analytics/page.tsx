"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/api";
import { formatDuration, num, pct } from "@/lib/format";
import { Card, ErrorState, PageHeader, Select, Spinner, Stat } from "@/components/ui";
import { BarList, DailyBars } from "@/components/charts";

interface Analytics {
  daily: Array<{ day: string; inbound: number; outbound: number }>;
  intents: Array<{ intent: string; count: number }>;
  urgency: Array<{ urgency: string; count: number }>;
  resolutionByIntent: Array<{ intent: string; status: string; count: number }>;
}

interface Overview {
  escalationRate: number | null;
  resolutionRate: number | null;
  avgFirstResponseSeconds: number | null;
  responseSamples: number;
  agentDecisions: Record<string, number>;
}

export default function AnalyticsPage() {
  const [days, setDays] = useState(30);
  const a = useSWR<Analytics>(`/api/v1/analytics?days=${days}`, fetcher);
  const o = useSWR<Overview>(`/api/v1/overview?days=${days}`, fetcher);
  const byIntent = new Map<string, { total: number; resolved: number }>();
  for (const r of a.data?.resolutionByIntent ?? []) {
    const e = byIntent.get(r.intent) ?? { total: 0, resolved: 0 };
    e.total += r.count;
    if (r.status === "RESOLVED" || r.status === "CLOSED") e.resolved += r.count;
    byIntent.set(r.intent, e);
  }
  return (
    <>
      <PageHeader
        title="Analytics"
        description="Computed from stored conversations and agent decisions."
        actions={
          <Select aria-label="Period" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </Select>
        }
      />
      {(a.isLoading || o.isLoading) && <Spinner />}
      {a.error && <ErrorState error={a.error} retry={() => a.mutate()} />}
      {o.data && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Escalation rate" value={pct(o.data.escalationRate)} />
          <Stat label="Resolution rate" value={pct(o.data.resolutionRate)} />
          <Stat
            label="Avg first response"
            value={
              o.data.avgFirstResponseSeconds === null ? "—" : formatDuration(o.data.avgFirstResponseSeconds)
            }
            hint={`${num(o.data.responseSamples)} samples`}
          />
          <Stat
            label="AI decisions"
            value={num(Object.values(o.data.agentDecisions).reduce((s, v) => s + v, 0))}
            hint={Object.entries(o.data.agentDecisions)
              .map(([k, v]) => `${k.toLowerCase()} ${v}`)
              .join(" · ")}
          />
        </div>
      )}
      {a.data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Messages per day" className="lg:col-span-2">
            <DailyBars
              rows={a.data.daily}
              series={[
                { key: "inbound", label: "Incoming", className: "bg-sky-500" },
                { key: "outbound", label: "Sent", className: "bg-emerald-600" },
              ]}
            />
          </Card>
          <Card title="Top intents">
            <BarList
              items={a.data.intents
                .slice(0, 12)
                .map((i) => ({ label: i.intent.replace(/_/g, " "), value: i.count }))}
            />
          </Card>
          <Card title="Urgency">
            <BarList
              items={a.data.urgency.map((u) => ({ label: u.urgency.toLowerCase(), value: u.count }))}
            />
          </Card>
          <Card title="Resolution by intent" className="lg:col-span-2">
            <BarList
              items={[...byIntent.entries()]
                .sort((x, y) => y[1].total - x[1].total)
                .map(([intent, v]) => ({
                  label: `${intent.replace(/_/g, " ")} (${v.resolved}/${v.total})`,
                  value: v.total ? v.resolved / v.total : 0,
                }))}
              format={(v) => pct(v)}
            />
          </Card>
        </div>
      )}
    </>
  );
}
