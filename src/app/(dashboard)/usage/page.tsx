"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/api";
import { num, usd } from "@/lib/format";
import { Card, ErrorState, PageHeader, Select, Spinner, Stat, Table, Td } from "@/components/ui";
import { DailyBars } from "@/components/charts";

interface Usage {
  byProvider: Array<{
    provider: string;
    model: string;
    kind: string;
    success: boolean;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number | null;
    avgLatencyMs: number | null;
  }>;
  daily: Array<{ day: string; costUsd: number; tokens: number; calls: number }>;
  budgets: Array<{ id: string; name: string; monthlyTokenBudget: number | null; usedThisMonth: number }>;
}

export default function UsagePage() {
  const [days, setDays] = useState(30);
  const { data, error, isLoading, mutate } = useSWR<Usage>(`/api/v1/usage?days=${days}`, fetcher);
  const totals = data?.byProvider.reduce(
    (t, r) => ({
      calls: t.calls + r.calls,
      tokens: t.tokens + r.inputTokens + r.outputTokens,
      cost: t.cost + (r.costUsd ?? 0),
      failed: t.failed + (r.success ? 0 : r.calls),
    }),
    { calls: 0, tokens: 0, cost: 0, failed: 0 },
  );
  return (
    <>
      <PageHeader
        title="Usage & costs"
        description="Token counts come from provider responses. Costs are estimates from your configured prices or the built-in price list; check your provider's invoice for billing."
        actions={
          <Select aria-label="Period" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </Select>
        }
      />
      {isLoading && <Spinner />}
      {error && <ErrorState error={error} retry={() => mutate()} />}
      {data && totals && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="AI calls" value={num(totals.calls)} />
            <Stat label="Tokens" value={num(totals.tokens)} />
            <Stat label="Estimated cost" value={usd(totals.cost)} />
            <Stat
              label="Failed calls"
              value={num(totals.failed)}
              tone={totals.failed > 0 ? "warn" : undefined}
            />
          </div>
          <Card title="Estimated cost per day">
            <DailyBars
              rows={data.daily}
              series={[{ key: "costUsd", label: "Cost (USD)", className: "bg-emerald-600" }]}
              format={(v) => usd(v)}
            />
          </Card>
          <Card title="By provider and model">
            <Table
              head={[
                "Provider",
                "Model",
                "Purpose",
                "Result",
                "Calls",
                "Input tokens",
                "Output tokens",
                "Est. cost",
                "Avg latency",
              ]}
              empty={data.byProvider.length === 0}
            >
              {data.byProvider.map((r, i) => (
                <tr key={i}>
                  <Td>{r.provider}</Td>
                  <Td className="font-mono text-xs">{r.model}</Td>
                  <Td>{r.kind}</Td>
                  <Td>{r.success ? "ok" : "failed"}</Td>
                  <Td>{num(r.calls)}</Td>
                  <Td>{num(r.inputTokens)}</Td>
                  <Td>{num(r.outputTokens)}</Td>
                  <Td>{usd(r.costUsd)}</Td>
                  <Td>{r.avgLatencyMs === null ? "—" : `${Math.round(r.avgLatencyMs)} ms`}</Td>
                </tr>
              ))}
            </Table>
          </Card>
          <Card title="Monthly token budgets">
            <Table head={["Provider", "Used this month", "Budget", ""]} empty={data.budgets.length === 0}>
              {data.budgets.map((b) => {
                const ratio = b.monthlyTokenBudget ? b.usedThisMonth / b.monthlyTokenBudget : null;
                return (
                  <tr key={b.id}>
                    <Td>{b.name}</Td>
                    <Td>{num(b.usedThisMonth)}</Td>
                    <Td>{b.monthlyTokenBudget ? num(b.monthlyTokenBudget) : "unlimited"}</Td>
                    <Td className="w-48">
                      {ratio !== null && (
                        <div
                          className="h-2 rounded bg-slate-100 dark:bg-slate-800"
                          role="meter"
                          aria-valuenow={Math.round(ratio * 100)}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label="Budget used"
                        >
                          <div
                            className={`h-2 rounded ${ratio > 0.9 ? "bg-red-600" : ratio > 0.7 ? "bg-amber-500" : "bg-emerald-600"}`}
                            style={{ width: `${Math.min(100, ratio * 100)}%` }}
                          />
                        </div>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </Table>
          </Card>
        </div>
      )}
    </>
  );
}
