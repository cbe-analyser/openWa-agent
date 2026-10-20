import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { env } from "../env";
import { badRequest } from "../errors";

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

function inCidr(ip: string, cidr: string): boolean {
  const [base, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base!) & mask);
}

const PRIVATE_V4 = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "224.0.0.0/4",
  "240.0.0.0/4",
];

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) return PRIVATE_V4.some((c) => inCidr(ip, c));
  const v6 = ip.toLowerCase();
  if (v6 === "::1" || v6 === "::") return true;
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80") || v6.startsWith("ff");
}

/**
 * Validates that an outbound URL is http(s) and does not resolve to a private, loopback or
 * link-local address (prevents SSRF against cloud metadata endpoints and internal services).
 */
export async function assertPublicUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw badRequest("Invalid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw badRequest("Only http(s) URLs are allowed");
  if (url.username || url.password) throw badRequest("URLs with embedded credentials are not allowed");
  if (env().ALLOW_PRIVATE_NETWORK_FETCH) return url;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw badRequest("URL resolves to a private or reserved network address");
  }
  return url;
}

/** fetch() with SSRF protection, no redirects to private hosts, timeout and size cap. */
export async function safeFetch(
  rawUrl: string,
  init: RequestInit & { timeoutMs?: number; maxBytes?: number } = {},
): Promise<{ status: number; headers: Headers; body: Buffer }> {
  const { timeoutMs = 10_000, maxBytes = 5 * 1024 * 1024, ...rest } = init;
  let current = rawUrl;
  for (let hop = 0; hop < 4; hop++) {
    await assertPublicUrl(current);
    const res = await fetch(current, { ...rest, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location")!, current).toString();
      continue;
    }
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw badRequest(`Response exceeds ${Math.round(maxBytes / 1024)} KB limit`);
        }
        chunks.push(value);
      }
    }
    return { status: res.status, headers: res.headers, body: Buffer.concat(chunks) };
  }
  throw badRequest("Too many redirects");
}
