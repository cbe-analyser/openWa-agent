"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { api, fetcher } from "@/lib/api";
import { dateTime, timeAgo } from "@/lib/format";
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
  Spinner,
  Table,
  Td,
  Toggle,
  useAsyncAction,
} from "@/components/ui";

interface Me {
  user: { id: string; email: string; name: string; isInstanceAdmin: boolean };
  permissions: string[];
}
interface Session {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

export default function SecurityPage() {
  const me = useSWR<Me>("/api/v1/me", fetcher);
  return (
    <>
      <PageHeader
        title="Security & privacy"
        description="Emergency controls, your sign-in sessions and password, and how customer data is handled."
      />
      {me.data?.user.isInstanceAdmin && <KillSwitch />}
      <Sessions />
      <PasswordChange />
      <Card title="Customer data and privacy" className="mt-4">
        <ul className="list-disc space-y-2 pl-5 text-sm text-slate-600 dark:text-slate-300">
          <li>
            Each customer&apos;s data can be exported or deleted from their page under{" "}
            <Link className="underline" href="/customers">
              Customers
            </Link>{" "}
            (data subject access and erasure requests). Deleting requires the owner role.
          </li>
          <li>
            Set a retention period on the{" "}
            <Link className="underline" href="/agent">
              AI agent
            </Link>{" "}
            page to delete old messages automatically. Audit entries are kept for accountability.
          </li>
          <li>
            Customers who send an opt-out keyword (for example STOP) receive no further follow-ups or template
            messages until they opt in again.
          </li>
          <li>
            The agent never asks customers for passwords, PINs, one-time codes or full card numbers, and
            messages containing them are masked in logs.
          </li>
          <li>
            Message content you send to an external AI provider is processed by that provider under its own
            terms. Use a self-hosted Ollama model if data must stay on your servers.
          </li>
          <li>
            If you serve customers in Kenya, the Data Protection Act, 2019 applies: register with the Office
            of the Data Protection Commissioner where required, tell customers how their data is used, and
            honour access, correction and deletion requests. The project&apos;s{" "}
            <code>docs/data-protection.md</code> has a checklist. It is not legal advice.
          </li>
        </ul>
      </Card>
    </>
  );
}

function KillSwitch() {
  const { data, error, mutate } = useSWR<{ on: boolean }>("/api/v1/settings/kill-switch", fetcher);
  const action = useAsyncAction();
  return (
    <Card title="Global emergency switch" className="mb-4">
      {error && <ErrorState error={error} retry={() => mutate()} />}
      {data && (
        <>
          {data.on && (
            <Notice tone="red">AI replies are stopped for every organization on this instance.</Notice>
          )}
          <div className="mt-2">
            <Toggle
              label={data.on ? "Emergency stop is ON" : "Emergency stop is off"}
              checked={data.on}
              disabled={action.pending}
              onChange={async (on) => {
                if (on && !window.confirm("Stop all AI replies on this instance, for every organization?"))
                  return;
                await action.run(() => api("/api/v1/settings/kill-switch", { body: { on } }));
                await mutate();
              }}
            />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Takes effect immediately, including for replies already queued. The AI cannot change this switch.
            You can also force it on with <code>AI_KILL_SWITCH=true</code> in the environment.
          </p>
          <FormError error={action.error} />
        </>
      )}
    </Card>
  );
}

function Sessions() {
  const { data, error, isLoading, mutate } = useSWR<{ items: Session[] }>("/api/v1/sessions", fetcher);
  const action = useAsyncAction();
  return (
    <Card title="Your sign-in sessions">
      {isLoading && <Spinner />}
      {error && <ErrorState error={error} retry={() => mutate()} />}
      {data && (
        <Table head={["Device", "IP", "Last active", "Expires", ""]} empty={data.items.length === 0}>
          {data.items.map((s) => (
            <tr key={s.id}>
              <Td className="max-w-xs truncate text-xs">
                {s.userAgent ?? "unknown"} {s.current && <Badge tone="green">this device</Badge>}
              </Td>
              <Td>{s.ip ?? "—"}</Td>
              <Td>{timeAgo(s.lastSeenAt)}</Td>
              <Td>{dateTime(s.expiresAt)}</Td>
              <Td>
                {!s.current && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={async () => (
                      await action.run(() => api(`/api/v1/sessions/${s.id}`, { method: "DELETE" })),
                      await mutate()
                    )}
                  >
                    Sign out
                  </Button>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}
      <FormError error={action.error} />
    </Card>
  );
}

function PasswordChange() {
  const [f, setF] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [done, setDone] = useState(false);
  const action = useAsyncAction();
  return (
    <Card title="Change password" className="mt-4">
      <form
        className="grid gap-3 sm:grid-cols-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setDone(false);
          if (f.newPassword !== f.confirm) return action.setError("The new passwords do not match");
          if (
            await action.run(() =>
              api("/api/v1/me/password", {
                body: { currentPassword: f.currentPassword, newPassword: f.newPassword },
              }),
            )
          ) {
            setDone(true);
            setF({ currentPassword: "", newPassword: "", confirm: "" });
          }
        }}
      >
        <Field label="Current password" htmlFor="cp">
          <Input
            id="cp"
            type="password"
            autoComplete="current-password"
            required
            value={f.currentPassword}
            onChange={(e) => setF({ ...f, currentPassword: e.target.value })}
          />
        </Field>
        <Field
          label="New password"
          htmlFor="np"
          hint="At least 12 characters with three of: lowercase, uppercase, digits, symbols."
        >
          <Input
            id="np"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            value={f.newPassword}
            onChange={(e) => setF({ ...f, newPassword: e.target.value })}
          />
        </Field>
        <Field label="Confirm new password" htmlFor="np2">
          <Input
            id="np2"
            type="password"
            autoComplete="new-password"
            required
            value={f.confirm}
            onChange={(e) => setF({ ...f, confirm: e.target.value })}
          />
        </Field>
        <FormError error={action.error} />
        {done && (
          <p className="text-sm text-emerald-700 sm:col-span-3">
            Password changed. Your other sessions were signed out.
          </p>
        )}
        <div>
          <Button type="submit" loading={action.pending}>
            Change password
          </Button>
        </div>
      </form>
    </Card>
  );
}
