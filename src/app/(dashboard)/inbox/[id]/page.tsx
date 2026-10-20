"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import useSWR from "swr";
import { ArrowLeft, Bot, Pause, Play, UserCheck, Undo2 } from "lucide-react";
import { api, fetcher } from "@/lib/api";
import { customerName, dateTime, timeAgo } from "@/lib/format";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  FormError,
  Notice,
  Select,
  Spinner,
  Textarea,
  cn,
  useAsyncAction,
} from "@/components/ui";
import { ControlBadge, StatusBadge, UrgencyBadge } from "@/components/status";

interface Msg {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  authorType: string;
  type: string;
  body: string | null;
  status: string;
  error: string | null;
  errorCode: string | null;
  createdAt: string;
  media: { id?: string; mimeType?: string; filename?: string } | null;
  metadata: {
    citations?: Array<{ ref: string; title?: string }>;
    confidence?: number;
    reasons?: string[];
    suggestion?: boolean;
    holdingMessage?: boolean;
  };
}

interface Detail {
  id: string;
  status: string;
  control: string;
  aiPaused: boolean;
  intent: string | null;
  urgency: string;
  language: string | null;
  summary: string | null;
  tags: string[];
  resolutionNote: string | null;
  withinServiceWindow: boolean;
  assignedTo: { id: string; name: string } | null;
  customer: {
    id: string;
    name: string | null;
    profileName: string | null;
    waId: string;
    optedOut: boolean;
    tags: string[];
  };
  channel: { name: string; kind: string };
  messages: Msg[];
  notes: Array<{ id: string; body: string; createdAt: string; author: { name: string } | null }>;
  tickets: Array<{ id: string; number: number; subject: string; status: string }>;
  followUps: Array<{ id: string; kind: string; status: string; dueAt: string; reason: string | null }>;
  agentRuns: Array<{
    id: string;
    createdAt: string;
    status: string;
    decision: string | null;
    intent: string | null;
    confidence: number | null;
    reasons: string[];
    provider: string | null;
    model: string | null;
    error: string | null;
    costUsd: number | null;
  }>;
  auditTrail: Array<{
    id: string;
    action: string;
    actorType: string;
    createdAt: string;
    metadata: Record<string, unknown>;
  }>;
  pendingTools: Array<{ id: string; toolName: string; input: unknown; createdAt: string }>;
}

function authorLabel(m: Msg) {
  if (m.direction === "INBOUND") return "Customer";
  return { AI: "AI agent", HUMAN: "Team", SYSTEM: "System" }[m.authorType] ?? m.authorType;
}

function Draft({ m, onDone }: { m: Msg; onDone: () => void }) {
  const [text, setText] = useState(m.body ?? "");
  const { pending, error, run } = useAsyncAction();
  return (
    <div className="space-y-2 rounded-lg border-2 border-dashed border-amber-400 bg-amber-50 p-3 dark:bg-amber-950/30">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge tone="yellow">
          {m.metadata.holdingMessage
            ? "Holding message awaiting approval"
            : m.metadata.suggestion
              ? "AI suggestion (escalated)"
              : "AI draft awaiting approval"}
        </Badge>
        {m.metadata.confidence !== undefined && (
          <span>confidence {Math.round(m.metadata.confidence * 100)}%</span>
        )}
        {m.metadata.reasons?.map((r) => (
          <Badge key={r}>{r.replace(/_/g, " ")}</Badge>
        ))}
      </div>
      <Textarea
        aria-label="Draft text"
        rows={Math.min(8, Math.max(3, text.split("\n").length + 1))}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {m.metadata.citations && m.metadata.citations.length > 0 && (
        <p className="text-xs text-slate-500">
          Sources: {m.metadata.citations.map((c) => c.title ?? c.ref).join(", ")}
        </p>
      )}
      <FormError error={error} />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          loading={pending}
          onClick={async () =>
            (await run(() =>
              api(`/api/v1/messages/${m.id}/approve`, { body: text !== m.body ? { text } : {} }),
            )) && onDone()
          }
        >
          {text !== m.body ? "Send edited" : "Approve & send"}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={async () =>
            (await run(() => api(`/api/v1/messages/${m.id}/reject`, { method: "POST", body: {} }))) &&
            onDone()
          }
        >
          Reject
        </Button>
      </div>
    </div>
  );
}

export default function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, isLoading, mutate } = useSWR<Detail>(`/api/v1/conversations/${id}`, fetcher, {
    refreshInterval: 4000,
  });
  const team = useSWR<{ members: Array<{ user: { id: string; name: string } }> }>("/api/v1/team", fetcher);
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const action = useAsyncAction();

  useEffect(() => {
    if (data && data.messages.some((m) => m.direction === "INBOUND"))
      void api(`/api/v1/conversations/${id}/read`, { method: "POST", body: {} }).catch(() => undefined);
  }, [id, data?.messages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (name: string, body: unknown = {}) => {
    if (await action.run(() => api(`/api/v1/conversations/${id}/${name}`, { body }))) await mutate();
  };

  if (isLoading) return <Spinner />;
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return null;
  const visible = data.messages.filter((m) => !["REJECTED", "SUPERSEDED"].includes(m.status));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/inbox"
          className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800"
          aria-label="Back to inbox"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold">{customerName(data.customer)}</h1>
          <p className="text-sm text-slate-500">
            +{data.customer.waId} · {data.channel.name}
            {data.intent && ` · ${data.intent.replace(/_/g, " ")}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ControlBadge control={data.control} aiPaused={data.aiPaused} />
          <StatusBadge status={data.status} />
          <UrgencyBadge urgency={data.urgency} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            {data.control === "PENDING_HUMAN" && (
              <Notice tone="yellow">
                This conversation was escalated. AI replies are paused until a team member takes over or
                returns it to AI.
              </Notice>
            )}
            {data.customer.optedOut && (
              <Notice tone="red">The customer opted out. No messages can be sent.</Notice>
            )}
            <ol className="mt-3 space-y-3" aria-label="Messages">
              {visible.map((m) =>
                m.status === "PENDING_APPROVAL" ? (
                  <li key={m.id}>
                    <Draft m={m} onDone={() => mutate()} />
                  </li>
                ) : (
                  <li
                    key={m.id}
                    className={cn("flex", m.direction === "OUTBOUND" ? "justify-end" : "justify-start")}
                  >
                    <div
                      className={cn(
                        "max-w-[85%] rounded-2xl px-3 py-2 text-sm",
                        m.direction === "INBOUND" && "bg-slate-100 dark:bg-slate-800",
                        m.direction === "OUTBOUND" &&
                          m.authorType === "AI" &&
                          "bg-violet-100 dark:bg-violet-900/40",
                        m.direction === "OUTBOUND" &&
                          m.authorType !== "AI" &&
                          "bg-emerald-100 dark:bg-emerald-900/40",
                      )}
                    >
                      <p className="mb-0.5 flex items-center gap-1 text-xs font-medium text-slate-500">
                        {m.authorType === "AI" && <Bot className="h-3 w-3" />} {authorLabel(m)}
                      </p>
                      <p className="prose-chat">{m.body ?? `[${m.type}]`}</p>
                      {m.media?.id && (
                        <a className="text-xs underline" href={`/api/v1/media/${m.id}`}>
                          Download {m.type}
                        </a>
                      )}
                      <p className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
                        {dateTime(m.createdAt)}
                        {m.direction === "OUTBOUND" && <StatusBadge status={m.status} />}
                        {m.metadata?.citations && m.metadata.citations.length > 0 && (
                          <span>
                            · sources: {m.metadata.citations.map((c) => c.title ?? c.ref).join(", ")}
                          </span>
                        )}
                      </p>
                      {m.status === "FAILED" && (
                        <p className="mt-1 text-xs text-red-600">
                          {m.errorCode}: {m.error}
                        </p>
                      )}
                    </div>
                  </li>
                ),
              )}
            </ol>
          </Card>

          <Card title="Reply">
            {!data.withinServiceWindow && (
              <Notice tone="yellow">
                More than 24 hours since the customer last wrote. WhatsApp only allows approved templates
                until they message again.
              </Notice>
            )}
            <form
              className="mt-2 space-y-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!reply.trim()) return;
                if (
                  await action.run(() =>
                    api(`/api/v1/conversations/${id}/messages`, { body: { text: reply } }),
                  )
                ) {
                  setReply("");
                  await mutate();
                }
              }}
            >
              <Textarea
                aria-label="Message"
                rows={3}
                placeholder={
                  data.control === "HUMAN"
                    ? "Type your reply…"
                    : "Sending a reply takes over this conversation and pauses AI replies."
                }
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                disabled={data.customer.optedOut || !data.withinServiceWindow}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="submit"
                  loading={action.pending}
                  disabled={!reply.trim() || data.customer.optedOut || !data.withinServiceWindow}
                >
                  Send
                </Button>
                <span className="text-xs text-slate-500">
                  Replies are sent from your WhatsApp Business number.
                </span>
              </div>
            </form>
            <FormError error={action.error} />
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Control">
            <div className="flex flex-wrap gap-2">
              {data.control !== "HUMAN" && (
                <Button size="sm" onClick={() => act("takeover")} loading={action.pending}>
                  <UserCheck className="h-4 w-4" /> Take over
                </Button>
              )}
              {data.control !== "AI" && (
                <Button size="sm" variant="secondary" onClick={() => act("release")} loading={action.pending}>
                  <Undo2 className="h-4 w-4" /> Return to AI
                </Button>
              )}
              {data.control === "AI" &&
                (data.aiPaused ? (
                  <Button size="sm" variant="secondary" onClick={() => act("resume")}>
                    <Play className="h-4 w-4" /> Resume AI
                  </Button>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => act("pause")}>
                    <Pause className="h-4 w-4" /> Pause AI
                  </Button>
                ))}
            </div>
            <div className="mt-3 grid gap-2">
              <label className="text-xs font-medium text-slate-500" htmlFor="assignee">
                Assigned to
              </label>
              <Select
                id="assignee"
                value={data.assignedTo?.id ?? ""}
                onChange={(e) => act("assign", { userId: e.target.value || null })}
              >
                <option value="">Unassigned</option>
                {team.data?.members.map((m) => (
                  <option key={m.user.id} value={m.user.id}>
                    {m.user.name}
                  </option>
                ))}
              </Select>
              <label className="text-xs font-medium text-slate-500" htmlFor="status">
                Status
              </label>
              <Select
                id="status"
                value={data.status}
                onChange={(e) => {
                  const s = e.target.value;
                  const noteText =
                    s === "RESOLVED" ? (window.prompt("Resolution note (optional)") ?? undefined) : undefined;
                  void act("status", { status: s, resolutionNote: noteText || undefined });
                }}
              >
                <option value="OPEN">Open</option>
                <option value="PENDING">Pending</option>
                <option value="ESCALATED">Escalated</option>
                <option value="RESOLVED">Resolved</option>
              </Select>
              {data.resolutionNote && (
                <p className="text-xs text-slate-500">Resolution: {data.resolutionNote}</p>
              )}
              <a
                className="text-xs text-brand-700 underline dark:text-brand-500"
                href={`/api/v1/conversations/${id}/export`}
              >
                Export transcript (JSON)
              </a>
            </div>
          </Card>

          {data.pendingTools.length > 0 && (
            <Card title="Actions awaiting approval">
              <ul className="space-y-2 text-sm">
                {data.pendingTools.map((t) => (
                  <li key={t.id} className="rounded-lg border border-amber-300 p-2">
                    <p className="font-medium">{t.toolName}</p>
                    <pre className="mt-1 overflow-x-auto text-xs">{JSON.stringify(t.input, null, 2)}</pre>
                    <div className="mt-2 flex gap-2">
                      <Button
                        size="sm"
                        onClick={async () =>
                          (await action.run(() =>
                            api(`/api/v1/tools/executions/${t.id}`, { body: { approve: true } }),
                          )) && mutate()
                        }
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={async () =>
                          (await action.run(() =>
                            api(`/api/v1/tools/executions/${t.id}`, { body: { approve: false } }),
                          )) && mutate()
                        }
                      >
                        Reject
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="Customer">
            <p className="text-sm">
              <Link className="underline" href={`/customers/${data.customer.id}`}>
                {customerName(data.customer)}
              </Link>
            </p>
            {data.summary && (
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{data.summary}</p>
            )}
            <div className="mt-2 flex flex-wrap gap-1">
              {data.customer.tags.map((t) => (
                <Badge key={t}>{t}</Badge>
              ))}
            </div>
          </Card>

          <Card title="Tickets">
            {data.tickets.length === 0 ? (
              <p className="text-sm text-slate-500">No tickets.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {data.tickets.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2">
                    <Link className="underline" href={`/tickets?focus=${t.id}`}>
                      #{t.number} {t.subject}
                    </Link>
                    <StatusBadge status={t.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Internal notes">
            <ul className="space-y-2 text-sm">
              {data.notes.map((n) => (
                <li key={n.id} className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/50">
                  <p className="prose-chat">{n.body}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {n.author?.name ?? "System"} · {timeAgo(n.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
            <form
              className="mt-2 flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  note.trim() &&
                  (await action.run(() => api(`/api/v1/conversations/${id}/notes`, { body: { body: note } })))
                ) {
                  setNote("");
                  await mutate();
                }
              }}
            >
              <Textarea
                aria-label="New note"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Visible to your team only"
              />
              <Button type="submit" size="sm" variant="secondary">
                Add
              </Button>
            </form>
          </Card>

          <Card title="Follow-ups">
            {data.followUps.length === 0 ? (
              <p className="text-sm text-slate-500">None scheduled.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {data.followUps.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {f.kind.replace(/_/g, " ").toLowerCase()} · {dateTime(f.dueAt)}
                    </span>
                    <StatusBadge status={f.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Agent activity">
            <ul className="space-y-2 text-xs">
              {data.agentRuns.map((r) => (
                <li key={r.id} className="rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                  <div className="flex flex-wrap items-center gap-1">
                    <Badge
                      tone={r.decision === "ESCALATE" ? "red" : r.decision === "SEND" ? "green" : "gray"}
                    >
                      {(r.decision ?? r.status).toLowerCase()}
                    </Badge>
                    {r.intent && <Badge>{r.intent.replace(/_/g, " ")}</Badge>}
                    {r.confidence !== null && <span>{Math.round(r.confidence * 100)}%</span>}
                    <span className="text-slate-500">{timeAgo(r.createdAt)}</span>
                  </div>
                  {r.reasons.length > 0 && (
                    <p className="mt-1 text-slate-500">
                      {r.reasons.map((x) => x.replace(/_/g, " ")).join(", ")}
                    </p>
                  )}
                  {r.model && (
                    <p className="text-slate-400">
                      {r.provider?.toLowerCase()} · {r.model}
                    </p>
                  )}
                  {r.error && <p className="text-red-600">{r.error}</p>}
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Audit trail">
            <ul className="space-y-1 text-xs">
              {data.auditTrail.map((a) => (
                <li key={a.id}>
                  <span className="font-medium">{a.action}</span>{" "}
                  <span className="text-slate-500">
                    by {a.actorType.toLowerCase()} · {dateTime(a.createdAt)}
                  </span>
                </li>
              ))}
              {data.auditTrail.length === 0 && <li className="text-slate-500">No control changes yet.</li>}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
