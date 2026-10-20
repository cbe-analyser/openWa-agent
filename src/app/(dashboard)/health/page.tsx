"use client";

import useSWR from "swr";
import { api, fetcher } from "@/lib/api";
import { formatDuration, timeAgo } from "@/lib/format";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  FormError,
  Notice,
  PageHeader,
  Spinner,
  Stat,
  Table,
  Td,
  useAsyncAction,
} from "@/components/ui";

interface Health {
  status: "ok" | "degraded";
  database: { ok: boolean; latencyMs: number; error?: string };
  worker: {
    healthy: boolean;
    pendingDue: number;
    running: number;
    queueLagSeconds: number;
    lastJobCompletedAt: string | null;
  };
  deadLetter: {
    count: number;
    recent: Array<{
      id: string;
      type: string;
      lastError: string | null;
      attempts: number;
      completedAt: string | null;
    }>;
  };
  providers: Array<{
    id: string;
    name: string;
    kind: string;
    model: string;
    enabled: boolean;
    lastHealthStatus: string | null;
    lastHealthAt: string | null;
    lastHealthError: string | null;
  }>;
  channels: Array<{
    id: string;
    name: string;
    kind: string;
    status: string;
    lastWebhookAt: string | null;
    lastError: string | null;
  }>;
  globalKillSwitch: boolean;
}

export default function HealthPage() {
  const { data, error, isLoading, mutate } = useSWR<Health>("/api/v1/health", fetcher, {
    refreshInterval: 10000,
  });
  const action = useAsyncAction();
  return (
    <>
      <PageHeader
        title="System health"
        description="Database, background worker, dead-letter queue, AI providers and channels. Refreshes every 10 seconds."
      />
      {isLoading && <Spinner />}
      {error && <ErrorState error={error} retry={() => mutate()} />}
      {data && (
        <div className="space-y-4">
          {data.globalKillSwitch && (
            <Notice tone="red">
              The global emergency switch is on. No AI replies are being sent on this instance.
            </Notice>
          )}
          {!data.worker.healthy && (
            <Notice tone="red">
              The job queue is {formatDuration(data.worker.queueLagSeconds)} behind. Check that the worker
              process is running (`npm run worker` or the worker container).
            </Notice>
          )}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat
              label="Overall"
              value={data.status === "ok" ? "Healthy" : "Degraded"}
              tone={data.status === "ok" ? "good" : "bad"}
            />
            <Stat
              label="Database"
              value={data.database.ok ? `${data.database.latencyMs} ms` : "Down"}
              tone={data.database.ok ? "good" : "bad"}
              hint={data.database.error}
            />
            <Stat
              label="Worker queue"
              value={`${data.worker.pendingDue} due`}
              hint={`${data.worker.running} running · lag ${formatDuration(data.worker.queueLagSeconds)} · last job ${timeAgo(data.worker.lastJobCompletedAt)}`}
              tone={data.worker.healthy ? "good" : "bad"}
            />
            <Stat
              label="Dead-letter jobs"
              value={data.deadLetter.count}
              tone={data.deadLetter.count ? "warn" : "good"}
            />
          </div>
          <Card title="Dead-letter queue">
            <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
              Jobs that failed after all retries. Fix the cause (for example a provider key or a WhatsApp
              token), then retry.
            </p>
            <Table
              head={["Job", "Attempts", "Failed", "Last error", ""]}
              empty={data.deadLetter.recent.length === 0}
            >
              {data.deadLetter.recent.map((j) => (
                <tr key={j.id}>
                  <Td className="font-mono text-xs">{j.type}</Td>
                  <Td>{j.attempts}</Td>
                  <Td>{timeAgo(j.completedAt)}</Td>
                  <Td className="max-w-md text-xs text-red-700">{j.lastError}</Td>
                  <Td>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={async () => (
                        await action.run(() => api(`/api/v1/jobs/${j.id}/retry`, { method: "POST" })),
                        await mutate()
                      )}
                    >
                      Retry
                    </Button>
                  </Td>
                </tr>
              ))}
            </Table>
            <FormError error={action.error} />
          </Card>
          <Card title="AI providers">
            <Table
              head={["Provider", "Model", "Status", "Checked", "Error"]}
              empty={data.providers.length === 0}
            >
              {data.providers.map((p) => (
                <tr key={p.id}>
                  <Td>
                    {p.name} {!p.enabled && <Badge>disabled</Badge>}
                  </Td>
                  <Td className="font-mono text-xs">{p.model}</Td>
                  <Td>
                    <Badge
                      tone={p.lastHealthStatus === "healthy" ? "green" : p.lastHealthStatus ? "red" : "gray"}
                    >
                      {p.lastHealthStatus ?? "not checked"}
                    </Badge>
                  </Td>
                  <Td>{timeAgo(p.lastHealthAt)}</Td>
                  <Td className="text-xs text-red-700">{p.lastHealthError}</Td>
                </tr>
              ))}
            </Table>
          </Card>
          <Card title="Channels">
            <Table
              head={["Channel", "Status", "Last webhook", "Last error"]}
              empty={data.channels.length === 0}
            >
              {data.channels.map((c) => (
                <tr key={c.id}>
                  <Td>{c.name}</Td>
                  <Td>
                    <Badge tone={c.status === "ACTIVE" ? "green" : c.status === "ERROR" ? "red" : "gray"}>
                      {c.status.toLowerCase()}
                    </Badge>
                  </Td>
                  <Td>{timeAgo(c.lastWebhookAt)}</Td>
                  <Td className="text-xs text-red-700">{c.lastError}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      )}
    </>
  );
}
