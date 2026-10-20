"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/api";
import { customerName, timeAgo } from "@/lib/format";
import { Badge, Card, ErrorState, Input, PageHeader, Spinner, Table, Td } from "@/components/ui";

interface Row {
  id: string;
  name: string | null;
  profileName: string | null;
  waId: string;
  tags: string[];
  optedOut: boolean;
  lastInboundAt: string | null;
  _count: { conversations: number; tickets: number };
}

export default function CustomersPage() {
  const [q, setQ] = useState("");
  const { data, error, isLoading, mutate } = useSWR<{ items: Row[] }>(
    `/api/v1/customers?limit=100${q ? `&q=${encodeURIComponent(q)}` : ""}`,
    fetcher,
    { keepPreviousData: true },
  );
  return (
    <>
      <PageHeader
        title="Customers"
        description="Everyone who has messaged your business, with their history and consent status."
      />
      <Card>
        <Input
          aria-label="Search customers"
          placeholder="Search by name, number or email"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="mb-4 max-w-md"
        />
        {isLoading && !data && <Spinner />}
        {error && <ErrorState error={error} retry={() => mutate()} />}
        {data && (
          <Table
            head={["Customer", "Number", "Tags", "Conversations", "Tickets", "Last message"]}
            empty={data.items.length === 0}
          >
            {data.items.map((c) => (
              <tr key={c.id}>
                <Td>
                  <Link className="font-medium underline" href={`/customers/${c.id}`}>
                    {customerName(c)}
                  </Link>{" "}
                  {c.optedOut && <Badge tone="red">opted out</Badge>}
                </Td>
                <Td>+{c.waId}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {c.tags.map((t) => (
                      <Badge key={t}>{t}</Badge>
                    ))}
                  </div>
                </Td>
                <Td>{c._count.conversations}</Td>
                <Td>{c._count.tickets}</Td>
                <Td>{timeAgo(c.lastInboundAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
