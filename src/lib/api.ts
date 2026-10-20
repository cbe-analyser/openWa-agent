"use client";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** Browser-side API helper: same-origin, cookie auth, CSRF header, JSON in/out. */
export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; form?: FormData } = {},
): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? (opts.body || opts.form ? "POST" : "GET"),
    credentials: "same-origin",
    headers: {
      "x-openwa-csrf": "1",
      ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/auth/")) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
  }
  const text = await res.text();
  const data = text
    ? (() => {
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      })()
    : null;
  if (!res.ok) {
    const err = (data as { error?: { message?: string; details?: unknown } } | null)?.error;
    const details = Array.isArray(err?.details)
      ? (err!.details as Array<{ path: string; message: string }>)
          .map((d) => `${d.path}: ${d.message}`)
          .join("; ")
      : "";
    throw new ApiError(
      [err?.message ?? `Request failed (${res.status})`, details].filter(Boolean).join(" — "),
      res.status,
      err?.details,
    );
  }
  return data as T;
}

export const fetcher = <T>(url: string) => api<T>(url);
