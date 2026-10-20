"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { Button, Field, FormError, Input, useAsyncAction } from "@/components/ui";

export function SignupForm() {
  const [form, setForm] = useState({ name: "", email: "", password: "", orgName: "" });
  const { pending, error, run } = useAsyncAction();
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await run(() => api("/api/auth/signup", { body: form }))) window.location.href = "/setup";
      }}
    >
      <h1 className="text-lg font-semibold">Create your organization</h1>
      <Field label="Business name" htmlFor="org">
        <Input id="org" required minLength={2} value={form.orgName} onChange={set("orgName")} />
      </Field>
      <Field label="Your name" htmlFor="name">
        <Input id="name" required autoComplete="name" value={form.name} onChange={set("name")} />
      </Field>
      <Field label="Email" htmlFor="email">
        <Input
          id="email"
          type="email"
          required
          autoComplete="username"
          value={form.email}
          onChange={set("email")}
        />
      </Field>
      <Field
        label="Password"
        htmlFor="password"
        hint="At least 12 characters using three of: lowercase, uppercase, digits, symbols."
      >
        <Input
          id="password"
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          value={form.password}
          onChange={set("password")}
        />
      </Field>
      <FormError error={error} />
      <Button type="submit" className="w-full" loading={pending}>
        Create organization
      </Button>
    </form>
  );
}
