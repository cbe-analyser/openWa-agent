"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { Send } from "lucide-react";
import { api, fetcher } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  FormError,
  Input,
  Notice,
  PageHeader,
  Select,
  Spinner,
  cn,
  useAsyncAction,
} from "@/components/ui";
import { ControlBadge } from "@/components/status";

interface Channel {
  id: string;
  name: string;
  kind: string;
}

interface SimView {
  conversationId?: string;
  control?: string;
  status?: string;
  messages: Array<{
    id: string;
    direction: string;
    body: string | null;
    type: string;
    createdAt: string;
    authorType: string;
  }>;
}

export default function SimulatorPage() {
  const channels = useSWR<{ items: Channel[] }>("/api/v1/channels", fetcher);
  const sims = channels.data?.items.filter((c) => c.kind === "SIMULATOR") ?? [];
  const [channelId, setChannelId] = useState("");
  const [from, setFrom] = useState("254700000001");
  const [name, setName] = useState("Test Customer");
  const [text, setText] = useState("");
  const send = useAsyncAction();
  const create = useAsyncAction();
  const activeChannel = channelId || sims[0]?.id || "";
  const view = useSWR<SimView>(
    activeChannel && /^\d{6,15}$/.test(from) ? `/api/v1/simulator/${activeChannel}?from=${from}` : null,
    fetcher,
    { refreshInterval: 1500 },
  );
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => bottom.current?.scrollIntoView({ block: "end" }), [view.data?.messages.length]);

  return (
    <>
      <PageHeader
        title="WhatsApp simulator"
        description="Test the complete agent pipeline as a customer would, without WhatsApp credentials. Nothing leaves this server."
      />
      {channels.isLoading && <Spinner />}
      {channels.error && <ErrorState error={channels.error} />}
      {channels.data && sims.length === 0 && (
        <EmptyState
          title="No simulator channel"
          description="Create a simulator channel to start testing. Make sure an AI provider is configured (the Mock provider works offline)."
          action={
            <>
              <Button
                loading={create.pending}
                onClick={async () =>
                  (await create.run(() =>
                    api("/api/v1/channels", { body: { kind: "SIMULATOR", name: "Simulator" } }),
                  )) && channels.mutate()
                }
              >
                Create simulator channel
              </Button>
              <FormError error={create.error} />
            </>
          }
        />
      )}
      {sims.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Simulated customer" className="lg:order-2">
            <div className="space-y-3">
              {sims.length > 1 && (
                <Field label="Channel" htmlFor="ch">
                  <Select id="ch" value={activeChannel} onChange={(e) => setChannelId(e.target.value)}>
                    {sims.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field
                label="Customer WhatsApp number"
                htmlFor="from"
                hint="Digits only with country code. Each number is a separate customer."
              >
                <Input
                  id="from"
                  inputMode="numeric"
                  value={from}
                  onChange={(e) => setFrom(e.target.value.replace(/\D/g, ""))}
                />
              </Field>
              <Field label="Profile name" htmlFor="name">
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              {view.data?.conversationId && (
                <div className="space-y-2 text-sm">
                  <ControlBadge control={view.data.control ?? "AI"} />
                  <p>
                    <Link className="underline" href={`/inbox/${view.data.conversationId}`}>
                      Open in inbox
                    </Link>{" "}
                    to see drafts, agent reasoning steps and to take over.
                  </p>
                </div>
              )}
              <Notice>
                Try: “What are your opening hours?”, “Where is my order number 12345?”, “I want a refund” or
                “STOP”.
              </Notice>
            </div>
          </Card>
          <Card className="lg:col-span-2">
            <div className="flex h-[60dvh] flex-col rounded-xl bg-[#efeae2] dark:bg-slate-950">
              <div className="flex-1 space-y-2 overflow-y-auto p-3" aria-live="polite">
                {view.data?.messages.length === 0 && (
                  <p className="p-6 text-center text-sm text-slate-500">
                    Send a message to start a conversation.
                  </p>
                )}
                {view.data?.messages.map((m) => (
                  <div
                    key={m.id}
                    className={cn("flex", m.direction === "INBOUND" ? "justify-end" : "justify-start")}
                  >
                    <div
                      className={cn(
                        "max-w-[80%] rounded-lg px-3 py-2 text-sm shadow-sm",
                        m.direction === "INBOUND"
                          ? "bg-[#d9fdd3] text-slate-900"
                          : "bg-white text-slate-900 dark:bg-slate-800 dark:text-slate-100",
                      )}
                    >
                      <p className="prose-chat">{m.body ?? `[${m.type}]`}</p>
                      <p className="mt-0.5 text-right text-[10px] text-slate-500">{timeAgo(m.createdAt)}</p>
                    </div>
                  </div>
                ))}
                <div ref={bottom} />
              </div>
              <form
                className="flex gap-2 border-t border-black/10 p-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!text.trim()) return;
                  const t = text;
                  setText("");
                  await send.run(() =>
                    api(`/api/v1/simulator/${activeChannel}`, { body: { from, name, text: t } }),
                  );
                  await view.mutate();
                }}
              >
                <Input
                  aria-label="Message as customer"
                  placeholder="Type a message as the customer"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  className="bg-white dark:bg-slate-900"
                />
                <Button type="submit" aria-label="Send" loading={send.pending}>
                  <Send className="h-4 w-4" />
                </Button>
              </form>
            </div>
            <FormError error={send.error} />
            <p className="mt-2 text-xs text-slate-500">
              Replies appear after the background worker processes the message (run{" "}
              <code>npm run worker</code>).
            </p>
          </Card>
        </div>
      )}
    </>
  );
}
