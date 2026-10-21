"use client";

import { useState } from "react";
import useSWR from "swr";
import { api, fetcher } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { BUILTIN_INTENTS } from "@/server/agent/intents";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Field,
  FormError,
  Input,
  Notice,
  PageHeader,
  Select,
  Spinner,
  Textarea,
  Toggle,
  useAsyncAction,
} from "@/components/ui";

interface Org {
  name: string;
  agentName: string;
  businessDescription: string;
  agentInstructions: string;
  autonomyMode: "COPILOT" | "SUPERVISED" | "AUTONOMOUS";
  aiPaused: boolean;
  confidenceThreshold: number;
  maxTroubleshootTurns: number;
  autoReplyIntents: string[];
  customIntents: Array<{ name: string; description: string; escalate?: boolean }>;
  escalationMessage: string;
  timezone: string;
  optOutKeywords: string[];
  optInKeywords: string[];
  followUpTemplateName: string | null;
  followUpTemplateLang: string;
  retentionDays: number | null;
}

interface Provider {
  id: string;
  name: string;
  kind: "ANTHROPIC" | "OPENAI_COMPATIBLE" | "OLLAMA" | "MOCK";
  model: string;
  baseUrl: string | null;
  hasApiKey: boolean;
  apiKeyHint: string | null;
  maxOutputTokens: number;
  temperature: number | null;
  timeoutMs: number;
  maxRetries: number;
  contextTokenLimit: number;
  monthlyTokenBudget: number | null;
  inputCostPerMTok: number | null;
  outputCostPerMTok: number | null;
  settings: Record<string, unknown>;
  isPrimary: boolean;
  allowAsFallback: boolean;
  fallbackPriority: number;
  enabled: boolean;
  lastHealthStatus: string | null;
  lastHealthAt: string | null;
  lastHealthError: string | null;
}

interface Embedding {
  kind: "LOCAL_HASH" | "OPENAI_COMPATIBLE" | "OLLAMA";
  model: string;
  baseUrl: string | null;
  dimensions: number;
  minRelevance: number;
  hasApiKey: boolean;
  apiKeyHint: string | null;
}

const MODES = [
  {
    value: "COPILOT",
    label: "Copilot",
    text: "The AI drafts every reply. A person approves, edits or rejects each one before anything is sent.",
  },
  {
    value: "SUPERVISED",
    label: "Supervised",
    text: "The AI sends low-risk replies for the intents you allow below. Everything else becomes a draft or is escalated.",
  },
  {
    value: "AUTONOMOUS",
    label: "Autonomous",
    text: "The AI replies on its own within its tools and knowledge. Escalation rules and safety checks still apply.",
  },
] as const;

const KIND_DEFAULTS: Record<Provider["kind"], { model: string; baseUrl: string; needsKey: boolean }> = {
  ANTHROPIC: { model: "claude-opus-5-5", baseUrl: "", needsKey: true },
  OPENAI_COMPATIBLE: { model: "gpt-4o-mini", baseUrl: "https://api.openai.com/v1", needsKey: true },
  OLLAMA: { model: "llama3.1:8b", baseUrl: "http://ollama:11434", needsKey: false },
  MOCK: { model: "mock-1", baseUrl: "", needsKey: false },
};

const splitList = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

export default function AgentPage() {
  const org = useSWR<Org>("/api/v1/settings/agent", fetcher);
  return (
    <>
      <PageHeader
        title="AI agent"
        description="How the agent behaves, which AI providers it uses and how much it may do on its own."
      />
      {org.isLoading && <Spinner />}
      {org.error && <ErrorState error={org.error} retry={() => org.mutate()} />}
      {org.data && <AgentSettings org={org.data} onSaved={() => org.mutate()} />}
      <Providers />
      <EmbeddingSettings />
    </>
  );
}

function AgentSettings({ org, onSaved }: { org: Org; onSaved: () => void }) {
  const [f, setForm] = useState(() => ({
    ...org,
    optOut: org.optOutKeywords.join(", "),
    optIn: org.optInKeywords.join(", "),
    custom: JSON.stringify(org.customIntents ?? [], null, 2),
  }));
  const action = useAsyncAction();
  const pause = useAsyncAction();
  const [saved, setSaved] = useState(false);
  // Any edit after a save hides the "Saved." note.
  const setF = (next: typeof f) => {
    setForm(next);
    setSaved(false);
  };
  const allIntents = [...BUILTIN_INTENTS.map((i) => i.name), ...(org.customIntents ?? []).map((c) => c.name)];

  return (
    <div className="space-y-4">
      <Card
        title="Emergency controls"
        actions={
          <Toggle
            label={org.aiPaused ? "AI replies paused for this organization" : "AI replies active"}
            checked={!org.aiPaused}
            disabled={pause.pending}
            onChange={async (active) => {
              if (
                !active &&
                !window.confirm(
                  "Pause all AI replies for this organization? Incoming messages will wait for your team.",
                )
              )
                return;
              await pause.run(() => api("/api/v1/settings/ai-pause", { body: { paused: !active } }));
              onSaved();
            }}
          />
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Pausing stops every AI-generated reply in this organization immediately. Messages are still received
          and queued for people. Instance administrators also have a global emergency switch on the Security
          page.
        </p>
        <FormError error={pause.error} />
      </Card>

      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          let customIntents: unknown;
          try {
            customIntents = JSON.parse(f.custom || "[]");
          } catch {
            action.setError("Custom intents must be valid JSON");
            return;
          }
          const ok = await action.run(() =>
            api("/api/v1/settings/agent", {
              method: "PATCH",
              body: {
                name: f.name,
                agentName: f.agentName,
                businessDescription: f.businessDescription,
                agentInstructions: f.agentInstructions,
                autonomyMode: f.autonomyMode,
                confidenceThreshold: Number(f.confidenceThreshold),
                maxTroubleshootTurns: Number(f.maxTroubleshootTurns),
                autoReplyIntents: f.autoReplyIntents,
                customIntents,
                escalationMessage: f.escalationMessage,
                timezone: f.timezone,
                optOutKeywords: splitList(f.optOut),
                optInKeywords: splitList(f.optIn),
                followUpTemplateName: f.followUpTemplateName || null,
                followUpTemplateLang: f.followUpTemplateLang,
                retentionDays: f.retentionDays ? Number(f.retentionDays) : null,
              },
            }),
          );
          if (ok) {
            setSaved(true);
            onSaved();
          }
        }}
      >
        <Card title="Autonomy mode">
          <div className="grid gap-3 md:grid-cols-3">
            {MODES.map((m) => (
              <label
                key={m.value}
                className={`cursor-pointer rounded-lg border p-3 text-sm ${f.autonomyMode === m.value ? "border-emerald-600 bg-emerald-50 dark:bg-emerald-950" : "border-slate-200 dark:border-slate-700"}`}
              >
                <input
                  type="radio"
                  name="mode"
                  className="mr-2"
                  checked={f.autonomyMode === m.value}
                  onChange={() => setF({ ...f, autonomyMode: m.value })}
                />
                <span className="font-semibold">{m.label}</span>
                <p className="mt-1 text-slate-600 dark:text-slate-300">{m.text}</p>
              </label>
            ))}
          </div>
          {f.autonomyMode === "AUTONOMOUS" && (
            <div className="mt-3">
              <Notice tone="yellow">
                Autonomous mode sends replies without review. Refund requests, payment disputes, legal or
                safety issues, angry customers, low confidence and anything the knowledge base cannot support
                are still escalated to a person.
              </Notice>
            </div>
          )}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field
              label="Confidence threshold"
              hint="Below this the AI drafts or escalates instead of sending."
            >
              <Input
                type="number"
                step="0.05"
                min={0.3}
                max={0.99}
                value={f.confidenceThreshold}
                onChange={(e) => setF({ ...f, confidenceThreshold: Number(e.target.value) })}
              />
            </Field>
            <Field label="Troubleshooting turns before escalation">
              <Input
                type="number"
                min={1}
                max={10}
                value={f.maxTroubleshootTurns}
                onChange={(e) => setF({ ...f, maxTroubleshootTurns: Number(e.target.value) })}
              />
            </Field>
          </div>
          <fieldset className="mt-4">
            <legend className="mb-2 text-sm font-medium">
              Intents the AI may answer without review (Supervised mode)
            </legend>
            <div className="flex flex-wrap gap-2">
              {allIntents.map((name) => {
                const def =
                  BUILTIN_INTENTS.find((i) => i.name === name) ??
                  org.customIntents.find((i) => i.name === name);
                const on = f.autoReplyIntents.includes(name);
                return (
                  <label
                    key={name}
                    className="flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-xs dark:border-slate-700"
                    title={def?.description}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={!!def?.escalate}
                      onChange={() =>
                        setF({
                          ...f,
                          autoReplyIntents: on
                            ? f.autoReplyIntents.filter((x) => x !== name)
                            : [...f.autoReplyIntents, name],
                        })
                      }
                    />
                    {name}
                    {def?.escalate && <Badge tone="red">always escalates</Badge>}
                  </label>
                );
              })}
            </div>
          </fieldset>
        </Card>

        <Card title="Identity and instructions">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Organization name" htmlFor="on">
              <Input id="on" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            </Field>
            <Field label="Agent name shown to customers" htmlFor="an">
              <Input
                id="an"
                value={f.agentName}
                onChange={(e) => setF({ ...f, agentName: e.target.value })}
              />
            </Field>
            <Field label="Timezone (IANA)" htmlFor="tz" hint="Used for follow-ups, e.g. Africa/Nairobi.">
              <Input id="tz" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} />
            </Field>
            <Field label="Data retention (days)" htmlFor="rd" hint="Empty keeps data until deleted.">
              <Input
                id="rd"
                type="number"
                min={7}
                max={3650}
                value={f.retentionDays ?? ""}
                onChange={(e) =>
                  setF({ ...f, retentionDays: e.target.value ? Number(e.target.value) : null })
                }
              />
            </Field>
          </div>
          <div className="mt-3 space-y-3">
            <Field
              label="About the business"
              htmlFor="bd"
              hint="Facts here are treated as trusted context. Put details customers ask about in the knowledge base."
            >
              <Textarea
                id="bd"
                rows={3}
                value={f.businessDescription}
                onChange={(e) => setF({ ...f, businessDescription: e.target.value })}
              />
            </Field>
            <Field
              label="Extra instructions"
              htmlFor="ai"
              hint="Tone, language, things to avoid. They cannot override the safety rules."
            >
              <Textarea
                id="ai"
                rows={4}
                value={f.agentInstructions}
                onChange={(e) => setF({ ...f, agentInstructions: e.target.value })}
              />
            </Field>
            <Field label="Message sent when handing over to a person" htmlFor="em">
              <Textarea
                id="em"
                rows={2}
                value={f.escalationMessage}
                onChange={(e) => setF({ ...f, escalationMessage: e.target.value })}
              />
            </Field>
          </div>
        </Card>

        <Card title="Consent and follow-ups">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Opt-out keywords"
              htmlFor="oo"
              hint="Comma-separated. Matching messages stop all follow-ups and marketing."
            >
              <Input id="oo" value={f.optOut} onChange={(e) => setF({ ...f, optOut: e.target.value })} />
            </Field>
            <Field label="Opt-in keywords" htmlFor="oi">
              <Input id="oi" value={f.optIn} onChange={(e) => setF({ ...f, optIn: e.target.value })} />
            </Field>
            <Field
              label="Follow-up template name"
              htmlFor="ft"
              hint="Approved WhatsApp template used when the 24-hour window is closed."
            >
              <Input
                id="ft"
                value={f.followUpTemplateName ?? ""}
                onChange={(e) => setF({ ...f, followUpTemplateName: e.target.value })}
                placeholder="e.g. support_follow_up"
              />
            </Field>
            <Field label="Template language" htmlFor="fl">
              <Input
                id="fl"
                value={f.followUpTemplateLang}
                onChange={(e) => setF({ ...f, followUpTemplateLang: e.target.value })}
              />
            </Field>
          </div>
        </Card>

        <Card title="Custom intents">
          <Field
            label="JSON list"
            htmlFor="ci"
            hint={
              <>
                Example:{" "}
                <code>{`[{"name":"warranty_claim","description":"Customer wants to claim a warranty","escalate":true}]`}</code>
                . Names use lowercase letters, digits and underscores.
              </>
            }
          >
            <Textarea
              id="ci"
              rows={5}
              className="font-mono text-xs"
              value={f.custom}
              onChange={(e) => setF({ ...f, custom: e.target.value })}
            />
          </Field>
        </Card>

        <div className="flex items-center gap-3">
          <Button type="submit" loading={action.pending}>
            Save agent settings
          </Button>
          {saved && <span className="text-sm text-emerald-700">Saved.</span>}
          <FormError error={action.error} />
        </div>
      </form>
    </div>
  );
}

type ProviderForm = {
  name: string;
  kind: Provider["kind"];
  model: string;
  baseUrl: string;
  apiKey: string;
  maxOutputTokens: number;
  temperature: string;
  timeoutMs: number;
  maxRetries: number;
  contextTokenLimit: number;
  monthlyTokenBudget: string;
  inputCostPerMTok: string;
  outputCostPerMTok: string;
  settings: string;
  isPrimary: boolean;
  allowAsFallback: boolean;
  fallbackPriority: number;
  enabled: boolean;
};

function toForm(p?: Provider): ProviderForm {
  return {
    name: p?.name ?? "",
    kind: p?.kind ?? "ANTHROPIC",
    model: p?.model ?? KIND_DEFAULTS.ANTHROPIC.model,
    baseUrl: p?.baseUrl ?? "",
    apiKey: "",
    maxOutputTokens: p?.maxOutputTokens ?? 1024,
    temperature: p?.temperature === null || p?.temperature === undefined ? "" : String(p.temperature),
    timeoutMs: p?.timeoutMs ?? 45000,
    maxRetries: p?.maxRetries ?? 2,
    contextTokenLimit: p?.contextTokenLimit ?? 16000,
    monthlyTokenBudget: p?.monthlyTokenBudget ? String(p.monthlyTokenBudget) : "",
    inputCostPerMTok:
      p?.inputCostPerMTok === null || p?.inputCostPerMTok === undefined ? "" : String(p.inputCostPerMTok),
    outputCostPerMTok:
      p?.outputCostPerMTok === null || p?.outputCostPerMTok === undefined ? "" : String(p.outputCostPerMTok),
    settings: JSON.stringify(p?.settings ?? {}, null, 2),
    isPrimary: p?.isPrimary ?? false,
    allowAsFallback: p?.allowAsFallback ?? false,
    fallbackPriority: p?.fallbackPriority ?? 100,
    enabled: p?.enabled ?? true,
  };
}

const optNum = (s: string) => (s.trim() === "" ? null : Number(s));

function Providers() {
  const { data, error, isLoading, mutate } = useSWR<{ items: Provider[] }>(
    "/api/v1/settings/providers",
    fetcher,
  );
  const [editing, setEditing] = useState<Provider | "new" | null>(null);
  const [tests, setTests] = useState<Record<string, { ok: boolean; detail: string; latencyMs?: number }>>({});
  const action = useAsyncAction();

  return (
    <Card
      title="AI providers"
      className="mt-4"
      actions={
        <Button size="sm" onClick={() => setEditing("new")}>
          Add provider
        </Button>
      }
    >
      <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
        API keys are encrypted on the server and never sent back to the browser. A conversation is only sent
        to a fallback provider when that provider is marked &ldquo;allowed as fallback&rdquo;.
      </p>
      {isLoading && <Spinner />}
      {error && <ErrorState error={error} retry={() => mutate()} />}
      {data && data.items.length === 0 && (
        <Notice tone="yellow">No AI provider is configured. The agent cannot reply until you add one.</Notice>
      )}
      <ul className="divide-y divide-slate-200 dark:divide-slate-800">
        {data?.items.map((p) => (
          <li key={p.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="font-medium">
                {p.name} {p.isPrimary && <Badge tone="green">primary</Badge>}{" "}
                {p.allowAsFallback && <Badge tone="blue">fallback #{p.fallbackPriority}</Badge>}{" "}
                {!p.enabled && <Badge tone="gray">disabled</Badge>}
              </p>
              <p className="truncate text-xs text-slate-500">
                {p.kind.toLowerCase().replace("_", "-")} · {p.model}
                {p.hasApiKey ? ` · key ${p.apiKeyHint}` : ""}
                {p.lastHealthAt ? ` · last check ${p.lastHealthStatus} ${timeAgo(p.lastHealthAt)}` : ""}
              </p>
              {tests[p.id] && (
                <p className={`text-xs ${tests[p.id]!.ok ? "text-emerald-700" : "text-red-700"}`}>
                  {tests[p.id]!.ok ? "Healthy" : "Failed"}: {tests[p.id]!.detail}
                  {tests[p.id]!.latencyMs !== undefined ? ` (${tests[p.id]!.latencyMs} ms)` : ""}
                </p>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  const r = await action.run(() =>
                    api<{ ok: boolean; detail: string; latencyMs?: number }>(
                      `/api/v1/settings/providers/${p.id}/test`,
                      { method: "POST" },
                    ),
                  );
                  if (r) setTests((t) => ({ ...t, [p.id]: r }));
                  await mutate();
                }}
              >
                Test
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setEditing(p)}>
                Edit
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={async () => {
                  if (!window.confirm(`Delete provider "${p.name}"?`)) return;
                  await action.run(() => api(`/api/v1/settings/providers/${p.id}`, { method: "DELETE" }));
                  await mutate();
                }}
              >
                Delete
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <FormError error={action.error} />
      {editing && (
        <ProviderEditor
          key={editing === "new" ? "new" : editing.id}
          provider={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await mutate();
          }}
        />
      )}
    </Card>
  );
}

function ProviderEditor({
  provider,
  onClose,
  onSaved,
}: {
  provider?: Provider;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState<ProviderForm>(() => toForm(provider));
  const [clearKey, setClearKey] = useState(false);
  const action = useAsyncAction();
  const def = KIND_DEFAULTS[f.kind];
  return (
    <form
      className="mt-4 rounded-lg border border-slate-200 p-4 dark:border-slate-700"
      onSubmit={async (e) => {
        e.preventDefault();
        let settings: Record<string, unknown>;
        try {
          settings = JSON.parse(f.settings || "{}");
        } catch {
          action.setError("Model-specific settings must be valid JSON");
          return;
        }
        const body = {
          name: f.name,
          kind: f.kind,
          model: f.model,
          baseUrl: f.baseUrl.trim() || null,
          ...(f.apiKey ? { apiKey: f.apiKey } : clearKey ? { apiKey: null } : provider ? {} : {}),
          maxOutputTokens: Number(f.maxOutputTokens),
          temperature: optNum(f.temperature),
          timeoutMs: Number(f.timeoutMs),
          maxRetries: Number(f.maxRetries),
          contextTokenLimit: Number(f.contextTokenLimit),
          monthlyTokenBudget: optNum(f.monthlyTokenBudget),
          inputCostPerMTok: optNum(f.inputCostPerMTok),
          outputCostPerMTok: optNum(f.outputCostPerMTok),
          settings,
          isPrimary: f.isPrimary,
          allowAsFallback: f.allowAsFallback,
          fallbackPriority: Number(f.fallbackPriority),
          enabled: f.enabled,
        };
        const ok = await action.run(() =>
          provider
            ? api(`/api/v1/settings/providers/${provider.id}`, { method: "PATCH", body })
            : api("/api/v1/settings/providers", { body }),
        );
        if (ok) onSaved();
      }}
    >
      <h3 className="mb-3 font-semibold">{provider ? `Edit ${provider.name}` : "New AI provider"}</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Display name" htmlFor="pn">
          <Input id="pn" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Type" htmlFor="pk">
          <Select
            id="pk"
            value={f.kind}
            onChange={(e) => {
              const kind = e.target.value as Provider["kind"];
              setF({ ...f, kind, model: KIND_DEFAULTS[kind].model, baseUrl: KIND_DEFAULTS[kind].baseUrl });
            }}
          >
            <option value="ANTHROPIC">Anthropic (Claude)</option>
            <option value="OPENAI_COMPATIBLE">OpenAI-compatible API</option>
            <option value="OLLAMA">Ollama (self-hosted)</option>
            <option value="MOCK">Mock (testing only)</option>
          </Select>
        </Field>
        <Field label="Model" htmlFor="pm">
          <Input id="pm" required value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} />
        </Field>
        {f.kind !== "MOCK" && (
          <Field
            label="Endpoint (base URL)"
            htmlFor="pb"
            hint={f.kind === "ANTHROPIC" ? "Leave empty for the default Anthropic API." : undefined}
          >
            <Input
              id="pb"
              type="url"
              value={f.baseUrl}
              onChange={(e) => setF({ ...f, baseUrl: e.target.value })}
              placeholder={def.baseUrl}
            />
          </Field>
        )}
        {f.kind !== "MOCK" && (
          <Field
            label="API key"
            htmlFor="pkey"
            hint={
              provider?.hasApiKey
                ? `Stored (${provider.apiKeyHint}). Leave empty to keep it.`
                : def.needsKey
                  ? "Required."
                  : "Optional."
            }
          >
            <Input
              id="pkey"
              type="password"
              autoComplete="off"
              value={f.apiKey}
              onChange={(e) => setF({ ...f, apiKey: e.target.value })}
            />
            {provider?.hasApiKey && (
              <label className="mt-1 flex items-center gap-1 text-xs">
                <input type="checkbox" checked={clearKey} onChange={(e) => setClearKey(e.target.checked)} />{" "}
                Remove stored key
              </label>
            )}
          </Field>
        )}
        <Field label="Max response tokens">
          <Input
            type="number"
            min={64}
            max={64000}
            value={f.maxOutputTokens}
            onChange={(e) => setF({ ...f, maxOutputTokens: Number(e.target.value) })}
          />
        </Field>
        <Field label="Temperature" hint="Empty uses the model default. Some models ignore it.">
          <Input
            type="number"
            step="0.1"
            min={0}
            max={2}
            value={f.temperature}
            onChange={(e) => setF({ ...f, temperature: e.target.value })}
          />
        </Field>
        <Field label="Timeout (ms)">
          <Input
            type="number"
            min={2000}
            max={600000}
            value={f.timeoutMs}
            onChange={(e) => setF({ ...f, timeoutMs: Number(e.target.value) })}
          />
        </Field>
        <Field label="Retries">
          <Input
            type="number"
            min={0}
            max={6}
            value={f.maxRetries}
            onChange={(e) => setF({ ...f, maxRetries: Number(e.target.value) })}
          />
        </Field>
        <Field label="Context limit (tokens)">
          <Input
            type="number"
            min={1000}
            value={f.contextTokenLimit}
            onChange={(e) => setF({ ...f, contextTokenLimit: Number(e.target.value) })}
          />
        </Field>
        <Field label="Monthly token budget" hint="Empty for unlimited.">
          <Input
            type="number"
            min={1}
            value={f.monthlyTokenBudget}
            onChange={(e) => setF({ ...f, monthlyTokenBudget: e.target.value })}
          />
        </Field>
        <Field label="Input cost per 1M tokens (USD)" hint="Empty uses the built-in price list when known.">
          <Input
            type="number"
            step="0.01"
            min={0}
            value={f.inputCostPerMTok}
            onChange={(e) => setF({ ...f, inputCostPerMTok: e.target.value })}
          />
        </Field>
        <Field label="Output cost per 1M tokens (USD)">
          <Input
            type="number"
            step="0.01"
            min={0}
            value={f.outputCostPerMTok}
            onChange={(e) => setF({ ...f, outputCostPerMTok: e.target.value })}
          />
        </Field>
        <Field label="Fallback priority" hint="Lower runs first.">
          <Input
            type="number"
            min={0}
            max={1000}
            value={f.fallbackPriority}
            onChange={(e) => setF({ ...f, fallbackPriority: Number(e.target.value) })}
          />
        </Field>
      </div>
      <div className="mt-3">
        <Field
          label="Model-specific settings (JSON)"
          hint={
            f.kind === "ANTHROPIC"
              ? 'Optional, e.g. {"effort":"medium"} or {"sendTemperature":true}.'
              : f.kind === "OLLAMA"
                ? 'Optional, e.g. {"num_ctx":8192}.'
                : f.kind === "MOCK"
                  ? 'Testing: {"simulateOutage":true} makes every call fail.'
                  : "Optional extra request fields."
          }
        >
          <Textarea
            rows={3}
            className="font-mono text-xs"
            value={f.settings}
            onChange={(e) => setF({ ...f, settings: e.target.value })}
          />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap gap-4">
        <Toggle
          label="Primary provider"
          checked={f.isPrimary}
          onChange={(v) => setF({ ...f, isPrimary: v })}
        />
        <Toggle
          label="Allowed as fallback"
          checked={f.allowAsFallback}
          onChange={(v) => setF({ ...f, allowAsFallback: v })}
        />
        <Toggle label="Enabled" checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} />
      </div>
      <FormError error={action.error} />
      <div className="mt-3 flex gap-2">
        <Button type="submit" loading={action.pending}>
          Save provider
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function EmbeddingSettings() {
  const { data, error, isLoading, mutate } = useSWR<Embedding>("/api/v1/settings/embedding", fetcher);
  return (
    <Card title="Knowledge embeddings" className="mt-4">
      {isLoading && <Spinner />}
      {error && <ErrorState error={error} retry={() => mutate()} />}
      {data && <EmbeddingForm key={`${data.kind}:${data.model}`} cfg={data} onSaved={() => mutate()} />}
    </Card>
  );
}

function EmbeddingForm({ cfg, onSaved }: { cfg: Embedding; onSaved: () => void }) {
  const [f, setF] = useState({
    kind: cfg.kind,
    model: cfg.model,
    baseUrl: cfg.baseUrl ?? "",
    apiKey: "",
    dimensions: cfg.dimensions,
    minRelevance: cfg.minRelevance,
  });
  const action = useAsyncAction();
  const [saved, setSaved] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (
          (f.kind !== cfg.kind || f.model !== cfg.model) &&
          !window.confirm("Changing the embedding model re-indexes every document. Continue?")
        )
          return;
        const ok = await action.run(() =>
          api("/api/v1/settings/embedding", {
            method: "PUT",
            body: {
              kind: f.kind,
              model: f.kind === "LOCAL_HASH" ? undefined : f.model,
              baseUrl: f.kind === "LOCAL_HASH" ? null : f.baseUrl || null,
              ...(f.apiKey ? { apiKey: f.apiKey } : {}),
              dimensions: Number(f.dimensions),
              minRelevance: Number(f.minRelevance),
            },
          }),
        );
        if (ok) {
          setSaved(true);
          onSaved();
        }
      }}
    >
      <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
        The built-in local embedding works offline with no API key and suits small knowledge bases. For better
        semantic matching, use an OpenAI-compatible or Ollama embedding model.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Embedding provider">
          <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Embedding["kind"] })}>
            <option value="LOCAL_HASH">Built-in (local, no API)</option>
            <option value="OPENAI_COMPATIBLE">OpenAI-compatible</option>
            <option value="OLLAMA">Ollama</option>
          </Select>
        </Field>
        {f.kind !== "LOCAL_HASH" && (
          <>
            <Field label="Model">
              <Input
                required
                value={f.model}
                onChange={(e) => setF({ ...f, model: e.target.value })}
                placeholder={f.kind === "OLLAMA" ? "nomic-embed-text" : "text-embedding-3-small"}
              />
            </Field>
            <Field label="Endpoint">
              <Input
                type="url"
                value={f.baseUrl}
                onChange={(e) => setF({ ...f, baseUrl: e.target.value })}
                placeholder={f.kind === "OLLAMA" ? "http://ollama:11434" : "https://api.openai.com/v1"}
              />
            </Field>
            <Field
              label="API key"
              hint={cfg.hasApiKey ? `Stored (${cfg.apiKeyHint}). Leave empty to keep it.` : undefined}
            >
              <Input
                type="password"
                autoComplete="off"
                value={f.apiKey}
                onChange={(e) => setF({ ...f, apiKey: e.target.value })}
              />
            </Field>
          </>
        )}
        <Field label="Dimensions">
          <Input
            type="number"
            min={64}
            max={4096}
            value={f.dimensions}
            onChange={(e) => setF({ ...f, dimensions: Number(e.target.value) })}
          />
        </Field>
        <Field label="Minimum relevance" hint="Results below this score count as no evidence.">
          <Input
            type="number"
            step="0.01"
            min={0}
            max={1}
            value={f.minRelevance}
            onChange={(e) => setF({ ...f, minRelevance: Number(e.target.value) })}
          />
        </Field>
      </div>
      <FormError error={action.error} />
      <div className="mt-3 flex items-center gap-3">
        <Button type="submit" loading={action.pending}>
          Save embeddings
        </Button>
        {saved && <span className="text-sm text-emerald-700">Saved.</span>}
      </div>
    </form>
  );
}
