"use client";

import { useEffect, useState } from "react";
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
  Notice,
  PageHeader,
  Select,
  Spinner,
  Table,
  Td,
  Textarea,
  useAsyncAction,
} from "@/components/ui";

interface Channel {
  id: string;
  kind: "WHATSAPP_CLOUD" | "SIMULATOR";
  name: string;
  status: "PENDING" | "ACTIVE" | "ERROR" | "DISABLED";
  phoneNumberId: string | null;
  wabaId: string | null;
  displayPhoneNumber: string | null;
  apiVersion: string;
  hasAccessToken: boolean;
  hasAppSecret: boolean;
  hasVerifyToken: boolean;
  lastWebhookAt: string | null;
  lastError: string | null;
}

interface Template {
  name: string;
  language: string;
  status: string;
  category: string;
  body: string | null;
}

const STATUS_TONE = { PENDING: "yellow", ACTIVE: "green", ERROR: "red", DISABLED: "gray" } as const;

function useOrigin() {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  return origin;
}

export default function ConnectionsPage() {
  const { data, error, isLoading, mutate } = useSWR<{ items: Channel[] }>("/api/v1/channels", fetcher);
  const [mode, setMode] = useState<"cloud" | null>(null);
  const action = useAsyncAction();
  return (
    <>
      <PageHeader
        title="WhatsApp connections"
        description="Connect a WhatsApp Business number through the official WhatsApp Business Cloud API, or use the simulator for testing."
        actions={
          <div className="flex gap-2">
            <Button onClick={() => setMode(mode ? null : "cloud")}>Connect WhatsApp number</Button>
            <Button
              variant="secondary"
              loading={action.pending}
              onClick={async () => (
                await action.run(() =>
                  api("/api/v1/channels", { body: { kind: "SIMULATOR", name: "Simulator" } }),
                ),
                await mutate()
              )}
            >
              Add simulator
            </Button>
          </div>
        }
      />
      <FormError error={action.error} />
      {mode === "cloud" && <CloudWizard onDone={async () => (setMode(null), await mutate())} />}
      {isLoading && <Spinner />}
      {error && <ErrorState error={error} retry={() => mutate()} />}
      {data && data.items.length === 0 && (
        <EmptyState
          title="No connections"
          description="Connect a WhatsApp Business number or add a simulator to try the agent."
        />
      )}
      <div className="space-y-4">
        {data?.items.map((c) => (
          <ChannelCard key={c.id} channel={c} onChanged={() => mutate()} />
        ))}
      </div>
      <Card title="What the official API can and cannot do" className="mt-4">
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
          <li>
            The agent only sees messages sent to your business number after it is connected. It cannot read
            personal WhatsApp chats or past chat history.
          </li>
          <li>
            Free-form replies are allowed within 24 hours of the customer&apos;s last message. After that,
            only pre-approved message templates can be sent.
          </li>
          <li>
            Moving a number that is already used in the WhatsApp Business app, or using the app and the API
            together (coexistence), depends on Meta&apos;s eligibility rules.
          </li>
          <li>
            OpenWa Agent is independent software and is not affiliated with or endorsed by WhatsApp or Meta.
          </li>
        </ul>
      </Card>
    </>
  );
}

function CloudWizard({ onDone }: { onDone: () => void }) {
  const origin = useOrigin();
  const [f, setF] = useState({
    name: "WhatsApp",
    phoneNumberId: "",
    wabaId: "",
    displayPhoneNumber: "",
    apiVersion: "v21.0",
    accessToken: "",
    appSecret: "",
    verifyToken: "",
  });
  const action = useAsyncAction();
  const [created, setCreated] = useState<Channel | null>(null);

  if (created) {
    return (
      <Card title="Step 2: configure the webhook in Meta" className="mb-4">
        <WebhookInstructions origin={origin} channelId={created.id} />
        <Button className="mt-3" onClick={onDone}>
          Done
        </Button>
      </Card>
    );
  }

  return (
    <Card title="Step 1: enter your WhatsApp Cloud API details" className="mb-4">
      <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
        <li>In Meta for Developers, create a Business app and add the WhatsApp product.</li>
        <li>Under WhatsApp → API setup, copy the Phone number ID and WhatsApp Business Account ID.</li>
        <li>
          Create a System User in Business Settings with the whatsapp_business_messaging and
          whatsapp_business_management permissions and generate a permanent token.
        </li>
        <li>Copy the App Secret from App settings → Basic.</li>
        <li>
          Choose a random verify token of at least 16 characters (you will paste it into Meta in the next
          step).
        </li>
      </ol>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const c = await action.run(() =>
            api<Channel>("/api/v1/channels", {
              body: {
                kind: "WHATSAPP_CLOUD",
                name: f.name,
                phoneNumberId: f.phoneNumberId,
                ...(f.wabaId ? { wabaId: f.wabaId } : {}),
                ...(f.displayPhoneNumber ? { displayPhoneNumber: f.displayPhoneNumber } : {}),
                apiVersion: f.apiVersion,
                accessToken: f.accessToken,
                appSecret: f.appSecret,
                verifyToken: f.verifyToken,
              },
            }),
          );
          if (c) setCreated(c);
        }}
      >
        <Field label="Connection name">
          <Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Phone number ID">
          <Input
            required
            inputMode="numeric"
            pattern="\d{5,30}"
            value={f.phoneNumberId}
            onChange={(e) => setF({ ...f, phoneNumberId: e.target.value })}
          />
        </Field>
        <Field label="WhatsApp Business Account ID" hint="Needed for template management.">
          <Input
            inputMode="numeric"
            pattern="\d{5,30}"
            value={f.wabaId}
            onChange={(e) => setF({ ...f, wabaId: e.target.value })}
          />
        </Field>
        <Field label="Display phone number (optional)">
          <Input
            value={f.displayPhoneNumber}
            onChange={(e) => setF({ ...f, displayPhoneNumber: e.target.value })}
            placeholder="+254 7xx xxx xxx"
          />
        </Field>
        <Field label="Graph API version">
          <Input
            pattern="v\d{1,3}\.\d"
            value={f.apiVersion}
            onChange={(e) => setF({ ...f, apiVersion: e.target.value })}
          />
        </Field>
        <Field label="Permanent access token" hint="Stored encrypted. Never shown again.">
          <Input
            required
            type="password"
            autoComplete="off"
            minLength={20}
            value={f.accessToken}
            onChange={(e) => setF({ ...f, accessToken: e.target.value })}
          />
        </Field>
        <Field label="App secret" hint="Used to verify webhook signatures.">
          <Input
            required
            type="password"
            autoComplete="off"
            minLength={16}
            value={f.appSecret}
            onChange={(e) => setF({ ...f, appSecret: e.target.value })}
          />
        </Field>
        <Field label="Verify token" hint="At least 16 characters. Stored as a hash.">
          <div className="flex gap-2">
            <Input
              required
              type="text"
              autoComplete="off"
              minLength={16}
              value={f.verifyToken}
              onChange={(e) => setF({ ...f, verifyToken: e.target.value })}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                const bytes = crypto.getRandomValues(new Uint8Array(24));
                setF({
                  ...f,
                  verifyToken: Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""),
                });
              }}
            >
              Generate
            </Button>
          </div>
        </Field>
        <div className="sm:col-span-2">
          <Notice tone="yellow">
            Copy the verify token now. You will need it in Meta&apos;s webhook settings and it cannot be shown
            again after saving.
          </Notice>
        </div>
        <FormError error={action.error} />
        <div className="sm:col-span-2">
          <Button type="submit" loading={action.pending}>
            Save and continue
          </Button>
        </div>
      </form>
    </Card>
  );
}

function WebhookInstructions({ origin, channelId }: { origin: string; channelId: string }) {
  const url = `${origin}/api/webhooks/whatsapp/${channelId}`;
  return (
    <div className="space-y-2 text-sm">
      <p>In your Meta app, open WhatsApp → Configuration → Webhook and set:</p>
      <Field label="Callback URL">
        <div className="flex gap-2">
          <Input readOnly value={url} onFocus={(e) => e.target.select()} />
          <Button type="button" variant="secondary" onClick={() => navigator.clipboard?.writeText(url)}>
            Copy
          </Button>
        </div>
      </Field>
      <p>
        Verify token: the one you entered. Then subscribe to the <code>messages</code> webhook field.
      </p>
      {origin.startsWith("http://") && (
        <Notice tone="red">
          Meta only calls HTTPS URLs. Deploy behind HTTPS (see the deployment guide) before connecting a real
          number.
        </Notice>
      )}
    </div>
  );
}

function ChannelCard({ channel: c, onChanged }: { channel: Channel; onChanged: () => void }) {
  const origin = useOrigin();
  const action = useAsyncAction();
  const [health, setHealth] = useState<{ ok: boolean; detail: string } | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [rotate, setRotate] = useState(false);
  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          {c.name} <Badge tone={STATUS_TONE[c.status]}>{c.status.toLowerCase()}</Badge>
          <Badge tone={c.kind === "SIMULATOR" ? "purple" : "blue"}>
            {c.kind === "SIMULATOR" ? "simulator" : "WhatsApp Cloud API"}
          </Badge>
        </span>
      }
      actions={
        <div className="flex flex-wrap gap-1">
          <Button
            size="sm"
            variant="secondary"
            onClick={async () =>
              setHealth(
                (await action.run(() =>
                  api<{ ok: boolean; detail: string }>(`/api/v1/channels/${c.id}/health`, { method: "POST" }),
                )) ?? null,
              )
            }
          >
            Check health
          </Button>
          {c.kind === "WHATSAPP_CLOUD" && (
            <>
              <Button size="sm" variant="secondary" onClick={() => setShowTemplates(!showTemplates)}>
                Templates
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setRotate(!rotate)}>
                Update credentials
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => (
              await action.run(() =>
                api(`/api/v1/channels/${c.id}`, {
                  method: "PATCH",
                  body: { status: c.status === "DISABLED" ? "ACTIVE" : "DISABLED" },
                }),
              ),
              onChanged()
            )}
          >
            {c.status === "DISABLED" ? "Enable" : "Disable"}
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={async () => {
              if (!window.confirm(`Delete connection "${c.name}"? Its conversations are deleted too.`))
                return;
              await action.run(() => api(`/api/v1/channels/${c.id}`, { method: "DELETE" }));
              onChanged();
            }}
          >
            Delete
          </Button>
        </div>
      }
    >
      <dl className="grid gap-2 text-sm sm:grid-cols-3">
        {c.kind === "WHATSAPP_CLOUD" && (
          <>
            <div>
              <dt className="text-xs text-slate-500">Phone number ID</dt>
              <dd>{c.phoneNumberId}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Number</dt>
              <dd>{c.displayPhoneNumber ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Credentials</dt>
              <dd>
                {c.hasAccessToken ? "token ✓" : "token missing"} ·{" "}
                {c.hasAppSecret ? "secret ✓" : "secret missing"} ·{" "}
                {c.hasVerifyToken ? "verify token ✓" : "verify token missing"}
              </dd>
            </div>
          </>
        )}
        <div>
          <dt className="text-xs text-slate-500">Last webhook</dt>
          <dd>{timeAgo(c.lastWebhookAt)}</dd>
        </div>
      </dl>
      {c.lastError && <p className="mt-2 text-sm text-red-600">Last error: {c.lastError}</p>}
      {health && (
        <p className={`mt-2 text-sm ${health.ok ? "text-emerald-700" : "text-red-700"}`}>{health.detail}</p>
      )}
      <FormError error={action.error} />
      {c.kind === "WHATSAPP_CLOUD" && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium">Webhook settings</summary>
          <div className="mt-2">
            <WebhookInstructions origin={origin} channelId={c.id} />
          </div>
        </details>
      )}
      {rotate && <RotateCredentials channelId={c.id} onDone={() => (setRotate(false), onChanged())} />}
      {showTemplates && <Templates channelId={c.id} />}
    </Card>
  );
}

function RotateCredentials({ channelId, onDone }: { channelId: string; onDone: () => void }) {
  const [f, setF] = useState({ accessToken: "", appSecret: "", verifyToken: "" });
  const action = useAsyncAction();
  return (
    <form
      className="mt-3 grid gap-3 rounded border border-slate-200 p-3 sm:grid-cols-3 dark:border-slate-700"
      onSubmit={async (e) => {
        e.preventDefault();
        const body = Object.fromEntries(Object.entries(f).filter(([, v]) => v));
        if (!Object.keys(body).length) return action.setError("Enter at least one new value");
        if (await action.run(() => api(`/api/v1/channels/${channelId}`, { method: "PATCH", body }))) onDone();
      }}
    >
      <Field label="New access token">
        <Input
          type="password"
          autoComplete="off"
          value={f.accessToken}
          onChange={(e) => setF({ ...f, accessToken: e.target.value })}
        />
      </Field>
      <Field label="New app secret">
        <Input
          type="password"
          autoComplete="off"
          value={f.appSecret}
          onChange={(e) => setF({ ...f, appSecret: e.target.value })}
        />
      </Field>
      <Field label="New verify token">
        <Input
          autoComplete="off"
          value={f.verifyToken}
          onChange={(e) => setF({ ...f, verifyToken: e.target.value })}
        />
      </Field>
      <FormError error={action.error} />
      <div className="sm:col-span-3">
        <Button type="submit" size="sm" loading={action.pending}>
          Save new credentials
        </Button>
      </div>
    </form>
  );
}

function Templates({ channelId }: { channelId: string }) {
  const { data, error, isLoading, mutate } = useSWR<{ items: Template[] }>(
    `/api/v1/channels/${channelId}/templates`,
    fetcher,
  );
  const [f, setF] = useState({ name: "", language: "en", category: "UTILITY", body: "" });
  const action = useAsyncAction();
  return (
    <div className="mt-3 space-y-3">
      {isLoading && <Spinner />}
      {error && <ErrorState error={error} retry={() => mutate()} />}
      {data && (
        <Table head={["Name", "Language", "Category", "Status", "Body"]} empty={data.items.length === 0}>
          {data.items.map((t) => (
            <tr key={`${t.name}:${t.language}`}>
              <Td className="font-mono text-xs">{t.name}</Td>
              <Td>{t.language}</Td>
              <Td>{t.category.toLowerCase()}</Td>
              <Td>
                <Badge tone={t.status === "APPROVED" ? "green" : t.status === "REJECTED" ? "red" : "yellow"}>
                  {t.status.toLowerCase()}
                </Badge>
              </Td>
              <Td className="max-w-sm text-xs">{t.body}</Td>
            </tr>
          ))}
        </Table>
      )}
      <form
        className="grid gap-2 rounded border border-slate-200 p-3 sm:grid-cols-3 dark:border-slate-700"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await action.run(() => api(`/api/v1/channels/${channelId}/templates`, { body: f }))) {
            setF({ ...f, name: "", body: "" });
            await mutate();
          }
        }}
      >
        <p className="text-sm font-medium sm:col-span-3">Submit a new template for Meta review</p>
        <Input
          aria-label="Template name"
          placeholder="support_follow_up"
          pattern="[a-z0-9_]+"
          required
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
        />
        <Input
          aria-label="Language"
          required
          value={f.language}
          onChange={(e) => setF({ ...f, language: e.target.value })}
        />
        <Select
          aria-label="Category"
          value={f.category}
          onChange={(e) => setF({ ...f, category: e.target.value })}
        >
          <option>UTILITY</option>
          <option>MARKETING</option>
          <option>AUTHENTICATION</option>
        </Select>
        <div className="sm:col-span-3">
          <Textarea
            aria-label="Body"
            rows={3}
            required
            placeholder="Hi {{1}}, we are following up on your support request…"
            value={f.body}
            onChange={(e) => setF({ ...f, body: e.target.value })}
          />
        </div>
        <FormError error={action.error} />
        <div>
          <Button size="sm" type="submit" loading={action.pending}>
            Submit template
          </Button>
        </div>
      </form>
    </div>
  );
}
