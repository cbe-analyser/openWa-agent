"use client";

import Link from "next/link";
import useSWR from "swr";
import { CheckCircle2, Circle } from "lucide-react";
import { fetcher } from "@/lib/api";
import { Card, ErrorState, PageHeader, Spinner } from "@/components/ui";

interface Overview {
  providers: Array<{ enabled: boolean; lastHealthStatus: string | null }>;
  channels: Array<{ kind: string; status: string; lastWebhookAt: string | null }>;
  autonomyMode: string;
}
interface Docs {
  items: Array<{ status: string }>;
}

const REPO_DOCS = "https://github.com/cbe-analyser/openwa-agent/blob/main/docs";

export default function SetupPage() {
  const o = useSWR<Overview>("/api/v1/overview?days=30", fetcher);
  const k = useSWR<Docs>("/api/v1/knowledge/documents", fetcher);
  const steps = o.data
    ? [
        {
          done: o.data.providers.some((p) => p.enabled),
          title: "Add an AI provider",
          text: "Anthropic, any OpenAI-compatible API, or a self-hosted Ollama model.",
          href: "/agent",
        },
        {
          done: o.data.providers.some((p) => p.lastHealthStatus === "healthy"),
          title: "Test the provider",
          text: "Use the Test button so you know the key and model work.",
          href: "/agent",
        },
        {
          done: (k.data?.items ?? []).some((d) => d.status === "READY"),
          title: "Add knowledge",
          text: "Upload FAQs, policies, price lists and troubleshooting guides.",
          href: "/knowledge",
        },
        {
          done: o.data.channels.some((c) => c.kind === "SIMULATOR"),
          title: "Try the simulator",
          text: "Chat as a customer and watch how the agent replies, drafts or escalates.",
          href: "/simulator",
        },
        {
          done: o.data.channels.some((c) => c.kind === "WHATSAPP_CLOUD" && c.lastWebhookAt),
          title: "Connect WhatsApp",
          text: "Add your WhatsApp Business Cloud API number and point Meta's webhook at this server (HTTPS required).",
          href: "/connections",
        },
        {
          done: false,
          title: "Invite your team",
          text: "Agents answer escalations; viewers can only read.",
          href: "/team",
        },
        {
          done: o.data.autonomyMode !== "COPILOT",
          title: "Choose the autonomy level",
          text: "Start in Copilot, move to Supervised once the drafts look right.",
          href: "/agent",
        },
      ]
    : [];
  return (
    <>
      <PageHeader
        title="Setup & docs"
        description="Get from a fresh install to a working WhatsApp support agent."
      />
      {o.isLoading && <Spinner />}
      {o.error && <ErrorState error={o.error} retry={() => o.mutate()} />}
      {o.data && (
        <Card title="Getting started">
          <ol className="space-y-3">
            {steps.map((s, i) => (
              <li key={i} className="flex gap-3">
                {s.done ? (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-label="done" />
                ) : (
                  <Circle className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" aria-label="to do" />
                )}
                <div>
                  <Link href={s.href} className="font-medium underline-offset-2 hover:underline">
                    {i + 1}. {s.title}
                  </Link>
                  <p className="text-sm text-slate-600 dark:text-slate-300">{s.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      )}
      <Card title="Documentation" className="mt-4">
        <ul className="grid gap-2 text-sm sm:grid-cols-2">
          {[
            ["whatsapp-setup.md", "WhatsApp Business Cloud API setup"],
            ["ai-providers.md", "AI providers, models and Ollama hardware notes"],
            ["deployment.md", "Deploying on a VPS with Docker and HTTPS"],
            ["operations.md", "Backups, restore, credential rotation, upgrades"],
            ["api.md", "Developer API and webhooks"],
            ["architecture.md", "Architecture"],
            ["extending.md", "Adding tools, providers and channels"],
            ["threat-model.md", "Threat model"],
            ["data-protection.md", "Data protection (including Kenya DPA 2019)"],
            ["limitations.md", "Known limitations"],
            ["troubleshooting.md", "Troubleshooting"],
          ].map(([file, label]) => (
            <li key={file}>
              <a className="underline" href={`${REPO_DOCS}/${file}`} target="_blank" rel="noreferrer">
                {label}
              </a>
            </li>
          ))}
          <li>
            <a className="underline" href="/api/v1/openapi.json" target="_blank" rel="noreferrer">
              OpenAPI specification (this server)
            </a>
          </li>
        </ul>
      </Card>
    </>
  );
}
