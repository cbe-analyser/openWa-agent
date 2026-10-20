import { randomUUID } from "node:crypto";

export function clientIp(headers: Headers): string | null {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim().slice(0, 64);
  return headers.get("x-real-ip")?.slice(0, 64) ?? null;
}

export function requestIdFrom(headers: Headers): string {
  const incoming = headers.get("x-request-id");
  return incoming && /^[A-Za-z0-9._-]{1,64}$/.test(incoming) ? incoming : randomUUID();
}
