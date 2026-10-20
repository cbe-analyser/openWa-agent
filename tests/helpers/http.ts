import { NextRequest } from "next/server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- route handlers have differently typed params
type Handler = (req: NextRequest, rc: { params: Promise<any> }) => Promise<Response>;

export interface CallOptions {
  method?: string;
  path?: string;
  params?: Record<string, string>;
  cookie?: string;
  bearer?: string;
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
  /** Adds the same-origin + custom header pair required for cookie-authenticated mutations. */
  csrf?: boolean;
}

/** Invokes a Next.js route handler directly with a constructed request. */
export async function call(handler: Handler, o: CallOptions = {}) {
  const method = o.method ?? "GET";
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
  if (o.cookie) headers.cookie = o.cookie;
  if (o.bearer) headers.authorization = `Bearer ${o.bearer}`;
  if (o.body !== undefined) headers["content-type"] = "application/json";
  if (o.csrf ?? (!!o.cookie && method !== "GET")) {
    headers.origin = "http://localhost:3000";
    headers["x-openwa-csrf"] = "1";
  }
  const req = new NextRequest(new URL(o.path ?? "/api/test", "http://localhost:3000"), {
    method,
    headers,
    body: o.rawBody ?? (o.body !== undefined ? JSON.stringify(o.body) : undefined),
  });
  const res = await handler(req, { params: Promise.resolve(o.params ?? {}) });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return {
    status: res.status,
    json: json as Record<string, unknown> & { items?: Array<Record<string, unknown>> },
    headers: res.headers,
  };
}
