"use client";

import { useState } from "react";
import useSWRInfinite from "swr/infinite";
import { fetcher } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { Badge, Button, Card, ErrorState, Input, PageHeader, Spinner, Table, Td } from "@/components/ui";

interface Log {
  id: string;
  actorType: string;
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
}
type Page = { items: Log[]; nextCursor: string | null };

const ACTOR_TONE: Record<string, "blue" | "purple" | "gray" | "yellow"> = {
  USER: "blue",
  AI: "purple",
  SYSTEM: "gray",
  API_KEY: "yellow",
};

export default function AuditPage() {
  const [action, setAction] = useState("");
  const [target, setTarget] = useState("");
  const qs = `${action ? `&action=${encodeURIComponent(action)}` : ""}${target ? `&targetId=${encodeURIComponent(target)}` : ""}`;
  const { data, error, isLoading, size, setSize, mutate } = useSWRInfinite<Page>(
    (i, prev: Page | null) =>
      prev && !prev.nextCursor
        ? null
        : `/api/v1/audit?limit=100${qs}${prev?.nextCursor ? `&cursor=${prev.nextCursor}` : ""}`,
    fetcher,
  );
  const rows = data?.flatMap((p) => p.items) ?? [];
  const more = data?.[data.length - 1]?.nextCursor;
  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every security-relevant action by people, the AI, API keys and the system. Entries cannot be edited from the dashboard."
      />
      <Card>
        <div className="mb-4 grid gap-2 sm:grid-cols-2">
          <Input
            aria-label="Filter by action prefix"
            placeholder="Action starts with… e.g. conversation., ai., auth."
            value={action}
            onChange={(e) => setAction(e.target.value)}
          />
          <Input
            aria-label="Filter by target ID"
            placeholder="Target ID"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        </div>
        {isLoading && <Spinner />}
        {error && <ErrorState error={error} retry={() => mutate()} />}
        {data && (
          <Table head={["When", "Actor", "Action", "Target", "Details"]} empty={rows.length === 0}>
            {rows.map((l) => (
              <tr key={l.id}>
                <Td className="whitespace-nowrap">{dateTime(l.createdAt)}</Td>
                <Td>
                  <Badge tone={ACTOR_TONE[l.actorType] ?? "gray"}>
                    {l.actorType.toLowerCase().replace("_", " ")}
                  </Badge>
                  {l.actorId && <p className="font-mono text-xs text-slate-500">{l.actorId.slice(0, 12)}</p>}
                </Td>
                <Td className="font-mono text-xs">{l.action}</Td>
                <Td className="text-xs">
                  {l.targetType}
                  {l.targetId && <p className="font-mono text-slate-500">{l.targetId}</p>}
                </Td>
                <Td className="max-w-md">
                  {Object.keys(l.metadata ?? {}).length > 0 && (
                    <pre className="max-h-24 overflow-auto text-xs whitespace-pre-wrap">
                      {JSON.stringify(l.metadata)}
                    </pre>
                  )}
                  {l.ip && <p className="text-xs text-slate-500">IP {l.ip}</p>}
                </Td>
              </tr>
            ))}
          </Table>
        )}
        {more && (
          <Button className="mt-3" variant="secondary" onClick={() => setSize(size + 1)}>
            Load more
          </Button>
        )}
      </Card>
    </>
  );
}
