"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { api, fetcher } from "@/lib/api";
import { customerName, dateTime } from "@/lib/format";
import {
  Button,
  Card,
  ErrorState,
  FormError,
  PageHeader,
  Select,
  Spinner,
  Table,
  Td,
  useAsyncAction,
} from "@/components/ui";
import { StatusBadge } from "@/components/status";

interface F {
  id: string;
  kind: string;
  status: string;
  dueAt: string;
  timezone: string;
  reason: string | null;
  createdBy: string;
  conversationId: string;
  customer: { name: string | null; profileName: string | null; waId: string };
}

export default function FollowUpsPage() {
  const [status, setStatus] = useState("SCHEDULED");
  const { data, error, isLoading, mutate } = useSWR<{ items: F[] }>(
    `/api/v1/followups?limit=200${status ? `&status=${status}` : ""}`,
    fetcher,
    { refreshInterval: 15000 },
  );
  const action = useAsyncAction();
  return (
    <>
      <PageHeader
        title="Scheduled follow-ups"
        description="Durable, timezone-aware jobs. Customer-facing follow-ups are skipped automatically when the customer opted out, already replied, or the 24-hour window closed without an approved template."
      />
      <Card>
        <Select
          aria-label="Filter"
          className="mb-4 max-w-xs"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All</option>
          {["SCHEDULED", "SENT", "SKIPPED", "CANCELLED", "FAILED"].map((s) => (
            <option key={s} value={s}>
              {s.toLowerCase()}
            </option>
          ))}
        </Select>
        <FormError error={action.error} />
        {isLoading && <Spinner />}
        {error && <ErrorState error={error} retry={() => mutate()} />}
        {data && (
          <Table
            head={["Due", "Kind", "Customer", "Reason", "Created by", "Status", ""]}
            empty={data.items.length === 0}
          >
            {data.items.map((f) => (
              <tr key={f.id}>
                <Td>
                  {dateTime(f.dueAt, f.timezone)}{" "}
                  <span className="text-xs text-slate-500">({f.timezone})</span>
                </Td>
                <Td>{f.kind.replace(/_/g, " ").toLowerCase()}</Td>
                <Td>
                  <Link className="underline" href={`/inbox/${f.conversationId}`}>
                    {customerName(f.customer)}
                  </Link>
                </Td>
                <Td className="max-w-xs text-xs">{f.reason ?? "—"}</Td>
                <Td>{f.createdBy.toLowerCase()}</Td>
                <Td>
                  <StatusBadge status={f.status} />
                </Td>
                <Td>
                  {f.status === "SCHEDULED" && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={async () =>
                        (await action.run(() => api(`/api/v1/followups/${f.id}`, { method: "DELETE" }))) &&
                        mutate()
                      }
                    >
                      Cancel
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
