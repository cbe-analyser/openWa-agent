"use client";

import { useState } from "react";
import useSWR from "swr";
import { api, fetcher } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  FormError,
  Input,
  PageHeader,
  Spinner,
  Table,
  Td,
  Textarea,
  useAsyncAction,
} from "@/components/ui";

interface Doc {
  id: string;
  title: string;
  sourceType: string;
  category: string | null;
  fileName: string | null;
  url: string | null;
  status: "PENDING" | "PROCESSING" | "READY" | "FAILED";
  error: string | null;
  chunkCount: number;
  indexedAt: string | null;
  updatedAt: string;
}

interface Hit {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  content: string;
  vectorScore: number | null;
  textScore: number | null;
  score: number;
}

type Tab = "upload" | "text" | "faq" | "url";
const STATUS_TONE = { PENDING: "yellow", PROCESSING: "blue", READY: "green", FAILED: "red" } as const;

export default function KnowledgePage() {
  const { data, error, isLoading, mutate } = useSWR<{ items: Doc[] }>(
    "/api/v1/knowledge/documents",
    fetcher,
    {
      refreshInterval: (d) =>
        d?.items.some((x) => x.status === "PENDING" || x.status === "PROCESSING") ? 3000 : 30000,
    },
  );
  const [tab, setTab] = useState<Tab | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const action = useAsyncAction();

  return (
    <>
      <PageHeader
        title="Knowledge base"
        description="The agent answers business questions only from these sources. When nothing relevant is found it says so and offers a person instead."
        actions={
          <div className="flex flex-wrap gap-2">
            {(["upload", "text", "faq", "url"] as Tab[]).map((t) => (
              <Button
                key={t}
                size="sm"
                variant={tab === t ? "primary" : "secondary"}
                onClick={() => setTab(tab === t ? null : t)}
              >
                {t === "upload"
                  ? "Upload file"
                  : t === "text"
                    ? "Add text"
                    : t === "faq"
                      ? "Add FAQ"
                      : "Import URL"}
              </Button>
            ))}
          </div>
        }
      />
      {tab && (
        <AddSource
          tab={tab}
          onDone={async () => {
            setTab(null);
            await mutate();
          }}
        />
      )}
      <SearchTester />
      <Card title="Sources" className="mt-4">
        {isLoading && <Spinner />}
        {error && <ErrorState error={error} retry={() => mutate()} />}
        {data && data.items.length === 0 && (
          <EmptyState
            title="No knowledge yet"
            description="Upload your FAQ, price list, policies or troubleshooting guides so the agent can answer from them."
          />
        )}
        {data && data.items.length > 0 && (
          <Table head={["Title", "Type", "Status", "Chunks", "Updated", ""]}>
            {data.items.map((d) => (
              <tr key={d.id}>
                <Td>
                  <p className="font-medium">{d.title}</p>
                  <p className="text-xs text-slate-500">{d.fileName ?? d.url ?? d.category ?? ""}</p>
                  {d.error && <p className="text-xs text-red-600">{d.error}</p>}
                  {editing === d.id && (
                    <EditDoc id={d.id} onDone={async () => (setEditing(null), await mutate())} />
                  )}
                </Td>
                <Td>{d.sourceType.toLowerCase()}</Td>
                <Td>
                  <Badge tone={STATUS_TONE[d.status]}>{d.status.toLowerCase()}</Badge>
                </Td>
                <Td>{d.chunkCount}</Td>
                <Td>{timeAgo(d.updatedAt)}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setEditing(editing === d.id ? null : d.id)}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={async () => (
                        await action.run(() =>
                          api(`/api/v1/knowledge/documents/${d.id}/reindex`, { method: "POST" }),
                        ),
                        await mutate()
                      )}
                    >
                      Re-index
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={async () => {
                        if (!window.confirm(`Delete "${d.title}" and all of its indexed chunks?`)) return;
                        await action.run(() =>
                          api(`/api/v1/knowledge/documents/${d.id}`, { method: "DELETE" }),
                        );
                        await mutate();
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        )}
        <FormError error={action.error} />
      </Card>
    </>
  );
}

function AddSource({ tab, onDone }: { tab: Tab; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [faqs, setFaqs] = useState([{ question: "", answer: "" }]);
  const action = useAsyncAction();

  async function submit() {
    if (tab === "upload") {
      if (!file) throw new Error("Choose a file");
      const form = new FormData();
      form.set("file", file);
      if (title) form.set("title", title);
      if (category) form.set("category", category);
      return api("/api/v1/knowledge/documents", { form });
    }
    const base = { title, ...(category ? { category } : {}) };
    if (tab === "text") return api("/api/v1/knowledge/documents", { body: { type: "text", ...base, text } });
    if (tab === "faq")
      return api("/api/v1/knowledge/documents", {
        body: { type: "faq", ...base, items: faqs.filter((f) => f.question && f.answer) },
      });
    return api("/api/v1/knowledge/documents", {
      body: { type: "url", url, ...(title ? { title } : {}), ...(category ? { category } : {}) },
    });
  }

  return (
    <Card
      title={
        tab === "upload"
          ? "Upload a file"
          : tab === "text"
            ? "Add text"
            : tab === "faq"
              ? "Add FAQ entries"
              : "Import a public web page"
      }
      className="mb-4"
    >
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await action.run(submit)) onDone();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={tab === "upload" || tab === "url" ? "Title (optional)" : "Title"} htmlFor="kt">
            <Input
              id="kt"
              required={tab === "text" || tab === "faq"}
              minLength={2}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field label="Category (optional)" htmlFor="kc">
            <Input
              id="kc"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="billing, delivery, troubleshooting…"
            />
          </Field>
        </div>
        {tab === "upload" && (
          <Field
            label="File"
            htmlFor="kf"
            hint="PDF, DOCX, TXT, MD or CSV. Scanned PDFs without a text layer cannot be read."
          >
            <Input
              id="kf"
              type="file"
              required
              accept=".pdf,.docx,.txt,.md,.markdown,.csv"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </Field>
        )}
        {tab === "text" && (
          <Field label="Content" htmlFor="kx">
            <Textarea
              id="kx"
              rows={10}
              required
              minLength={20}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </Field>
        )}
        {tab === "url" && (
          <Field
            label="Public URL"
            htmlFor="ku"
            hint="Only public http(s) pages. Private network addresses are blocked."
          >
            <Input id="ku" type="url" required value={url} onChange={(e) => setUrl(e.target.value)} />
          </Field>
        )}
        {tab === "faq" && (
          <div className="space-y-3">
            {faqs.map((f, i) => (
              <div
                key={i}
                className="grid gap-2 rounded border border-slate-200 p-2 sm:grid-cols-2 dark:border-slate-700"
              >
                <Input
                  aria-label={`Question ${i + 1}`}
                  placeholder="Question"
                  value={f.question}
                  onChange={(e) =>
                    setFaqs(faqs.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)))
                  }
                />
                <Textarea
                  aria-label={`Answer ${i + 1}`}
                  rows={2}
                  placeholder="Answer"
                  value={f.answer}
                  onChange={(e) =>
                    setFaqs(faqs.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)))
                  }
                />
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setFaqs([...faqs, { question: "", answer: "" }])}
            >
              Add another question
            </Button>
          </div>
        )}
        <FormError error={action.error} />
        <Button type="submit" loading={action.pending}>
          Save and index
        </Button>
      </form>
    </Card>
  );
}

function EditDoc({ id, onDone }: { id: string; onDone: () => void }) {
  const { data, error } = useSWR<{ title: string; text: string; category: string | null }>(
    `/api/v1/knowledge/documents/${id}`,
    fetcher,
  );
  const [draft, setDraft] = useState<{ title: string; text: string; category: string } | null>(null);
  const action = useAsyncAction();
  if (error) return <ErrorState error={error} />;
  if (!data) return <Spinner />;
  const f = draft ?? { title: data.title, text: data.text, category: data.category ?? "" };
  return (
    <form
      className="mt-2 space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (
          await action.run(() =>
            api(`/api/v1/knowledge/documents/${id}`, {
              method: "PATCH",
              body: { title: f.title, text: f.text, ...(f.category ? { category: f.category } : {}) },
            }),
          )
        )
          onDone();
      }}
    >
      <Input aria-label="Title" value={f.title} onChange={(e) => setDraft({ ...f, title: e.target.value })} />
      <Input
        aria-label="Category"
        value={f.category}
        onChange={(e) => setDraft({ ...f, category: e.target.value })}
        placeholder="Category"
      />
      <Textarea
        aria-label="Content"
        rows={10}
        className="font-mono text-xs"
        value={f.text}
        onChange={(e) => setDraft({ ...f, text: e.target.value })}
      />
      <FormError error={action.error} />
      <Button size="sm" type="submit" loading={action.pending}>
        Save and re-index
      </Button>
    </form>
  );
}

function SearchTester() {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<{ chunks: Hit[]; sufficientEvidence: boolean } | null>(null);
  const hits = res?.chunks ?? null;
  const action = useAsyncAction();
  return (
    <Card title="Test retrieval">
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await action.run(() =>
            api<{ chunks: Hit[]; sufficientEvidence: boolean }>("/api/v1/knowledge/search", {
              body: { query: q },
            }),
          );
          if (r) setRes(r);
        }}
      >
        <Input
          aria-label="Test question"
          placeholder="Ask a question a customer might send…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          minLength={2}
          required
        />
        <Button type="submit" loading={action.pending}>
          Search
        </Button>
      </form>
      <FormError error={action.error} />
      {res && hits!.length > 0 && !res.sufficientEvidence && (
        <p className="mt-3 text-sm text-amber-700">
          These matches are below the relevance threshold, so the agent would treat them as insufficient
          evidence.
        </p>
      )}
      {hits && hits.length === 0 && (
        <p className="mt-3 text-sm text-amber-700">
          No source is relevant enough. The agent would not answer this from the knowledge base.
        </p>
      )}
      {hits && hits.length > 0 && (
        <ol className="mt-3 space-y-2">
          {hits.map((h) => (
            <li key={h.chunkId} className="rounded border border-slate-200 p-2 text-sm dark:border-slate-700">
              <p className="text-xs text-slate-500">
                {h.documentTitle} · score {h.score.toFixed(3)}
                {h.vectorScore !== null ? ` · semantic ${h.vectorScore.toFixed(2)}` : ""}
                {h.textScore !== null ? ` · keyword ${h.textScore.toFixed(2)}` : ""}
              </p>
              <p className="line-clamp-4 whitespace-pre-wrap">{h.content}</p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
