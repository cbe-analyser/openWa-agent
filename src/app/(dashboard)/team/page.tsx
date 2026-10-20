"use client";

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
  PageHeader,
  SecretReveal,
  Select,
  Spinner,
  Table,
  Td,
  useAsyncAction,
} from "@/components/ui";

interface Member {
  role: string;
  createdAt: string;
  user: { id: string; name: string; email: string; lastLoginAt: string | null; disabled: boolean };
}
interface Invitation {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
}
interface Me {
  user: { id: string };
  permissions: string[];
}

const ROLES = ["OWNER", "ADMIN", "AGENT", "VIEWER"];
const ROLE_TEXT: Record<string, string> = {
  OWNER: "Everything, including deleting customer data",
  ADMIN: "Settings, integrations, team and all conversations",
  AGENT: "Conversations, customers, tickets and follow-ups",
  VIEWER: "Read-only access",
};

export default function TeamPage() {
  const me = useSWR<Me>("/api/v1/me", fetcher);
  const { data, error, isLoading, mutate } = useSWR<{ members: Member[]; invitations: Invitation[] }>(
    "/api/v1/team",
    fetcher,
  );
  const canManage = me.data?.permissions.includes("team:manage") ?? false;
  const [invite, setInvite] = useState({ email: "", role: "AGENT" });
  const [link, setLink] = useState<string | null>(null);
  const action = useAsyncAction();

  return (
    <>
      <PageHeader
        title="Team"
        description="People who can see and answer conversations in this organization."
      />
      {canManage && (
        <Card title="Invite a team member" className="mb-4">
          {link ? (
            <SecretReveal
              label="Invitation link (valid for 7 days). Send it to the person over a trusted channel."
              value={link}
              onDone={() => setLink(null)}
            />
          ) : (
            <form
              className="flex flex-col gap-2 sm:flex-row sm:items-end"
              onSubmit={async (e) => {
                e.preventDefault();
                const r = await action.run(() =>
                  api<{ inviteUrl: string }>("/api/v1/team", { body: invite }),
                );
                if (r) {
                  setLink(r.inviteUrl);
                  setInvite({ email: "", role: "AGENT" });
                  await mutate();
                }
              }}
            >
              <Field label="Email" htmlFor="ie">
                <Input
                  id="ie"
                  type="email"
                  required
                  value={invite.email}
                  onChange={(e) => setInvite({ ...invite, email: e.target.value })}
                />
              </Field>
              <Field label="Role" htmlFor="ir">
                <Select
                  id="ir"
                  value={invite.role}
                  onChange={(e) => setInvite({ ...invite, role: e.target.value })}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r.toLowerCase()}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button type="submit" loading={action.pending}>
                Create invitation
              </Button>
            </form>
          )}
          <p className="mt-2 text-xs text-slate-500">{ROLE_TEXT[invite.role]}</p>
        </Card>
      )}
      <Card title="Members">
        {isLoading && <Spinner />}
        {error && <ErrorState error={error} retry={() => mutate()} />}
        {data && (
          <Table head={["Name", "Role", "Last sign-in", ""]} empty={data.members.length === 0}>
            {data.members.map((m) => (
              <tr key={m.user.id}>
                <Td>
                  <p className="font-medium">
                    {m.user.name} {m.user.id === me.data?.user.id && <Badge tone="blue">you</Badge>}{" "}
                    {m.user.disabled && <Badge tone="red">disabled</Badge>}
                  </p>
                  <p className="text-xs text-slate-500">{m.user.email}</p>
                </Td>
                <Td>
                  {canManage && m.user.id !== me.data?.user.id ? (
                    <Select
                      aria-label={`Role of ${m.user.name}`}
                      value={m.role}
                      onChange={async (e) => (
                        await action.run(() =>
                          api(`/api/v1/team/${m.user.id}`, {
                            method: "PATCH",
                            body: { role: e.target.value },
                          }),
                        ),
                        await mutate()
                      )}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r.toLowerCase()}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Badge>{m.role.toLowerCase()}</Badge>
                  )}
                </Td>
                <Td>{timeAgo(m.user.lastLoginAt)}</Td>
                <Td>
                  {canManage && m.user.id !== me.data?.user.id && (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={async () => {
                        if (
                          !window.confirm(
                            `Remove ${m.user.name} from this organization? Their sessions are signed out.`,
                          )
                        )
                          return;
                        await action.run(() => api(`/api/v1/team/${m.user.id}`, { method: "DELETE" }));
                        await mutate();
                      }}
                    >
                      Remove
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
        <FormError error={action.error} />
      </Card>
      {canManage && data && data.invitations.length > 0 && (
        <Card title="Pending invitations" className="mt-4">
          <Table head={["Email", "Role", "Expires", ""]}>
            {data.invitations.map((i) => (
              <tr key={i.id}>
                <Td>{i.email}</Td>
                <Td>{i.role.toLowerCase()}</Td>
                <Td>{dateTime(i.expiresAt)}</Td>
                <Td>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={async () => (
                      await action.run(() => api(`/api/v1/team/invitations/${i.id}`, { method: "DELETE" })),
                      await mutate()
                    )}
                  >
                    Revoke
                  </Button>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </>
  );
}
