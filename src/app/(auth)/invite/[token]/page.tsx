"use client";

import { use, useState } from "react";
import { api } from "@/lib/api";
import { Button, Field, FormError, Input, useAsyncAction } from "@/components/ui";

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const { pending, error, run } = useAsyncAction();
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await run(() => api("/api/auth/invitations/accept", { body: { token, name, password } })))
          window.location.href = "/inbox";
      }}
    >
      <h1 className="text-lg font-semibold">Join your team</h1>
      <p className="text-sm text-slate-500">
        If you already have an account with the invited email, enter its password.
      </p>
      <Field label="Your name" htmlFor="name">
        <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Password" htmlFor="password" hint="New accounts: at least 12 characters.">
        <Input
          id="password"
          type="password"
          required
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <FormError error={error} />
      <Button type="submit" className="w-full" loading={pending}>
        Accept invitation
      </Button>
    </form>
  );
}
