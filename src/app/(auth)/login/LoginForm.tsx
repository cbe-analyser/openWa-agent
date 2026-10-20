"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { Button, Field, FormError, Input, useAsyncAction } from "@/components/ui";

export function LoginForm({ canSignup }: { canSignup: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { pending, error, run } = useAsyncAction();
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await run(() => api("/api/auth/login", { body: { email, password } }));
        if (ok) {
          const next = new URLSearchParams(window.location.search).get("next");
          window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
        }
      }}
    >
      <h1 className="text-lg font-semibold">Sign in</h1>
      <Field label="Email" htmlFor="email">
        <Input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <FormError error={error} />
      <Button type="submit" className="w-full" loading={pending}>
        Sign in
      </Button>
      {canSignup && (
        <p className="text-center text-sm text-slate-500">
          New here?{" "}
          <Link className="font-medium text-brand-700 underline dark:text-brand-500" href="/signup">
            Create an organization
          </Link>
        </p>
      )}
    </form>
  );
}
