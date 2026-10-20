import { prisma } from "../db";
import { randomToken, sha256Hex } from "../security/crypto";
import type { AuthContext } from "./context";
import { API_KEY_SCOPES, type Permission } from "./permissions";

const PREFIX = "owa_live_";

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const secret = randomToken(30)
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 36);
  const id = randomToken(6)
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 8)
    .padEnd(8, "0");
  const key = `${PREFIX}${id}${secret}`;
  return { key, prefix: `${PREFIX}${id}`, hash: sha256Hex(key) };
}

export function sanitizeScopes(scopes: string[]): Permission[] {
  return [...new Set(scopes)].filter((s): s is Permission => (API_KEY_SCOPES as string[]).includes(s));
}

/** Verifies a presented API key. Keys are stored only as SHA-256 hashes (they are high-entropy). */
export async function resolveApiKey(
  presented: string,
  ip: string | null,
  requestId: string,
): Promise<AuthContext | null> {
  if (!presented.startsWith(PREFIX) || presented.length > 100) return null;
  const apiKey = await prisma.apiKey.findUnique({ where: { keyHash: sha256Hex(presented) } });
  if (!apiKey || apiKey.revokedAt || (apiKey.expiresAt && apiKey.expiresAt < new Date())) return null;
  if (!apiKey.lastUsedAt || Date.now() - apiKey.lastUsedAt.getTime() > 60_000) {
    await prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });
  }
  return {
    kind: "apiKey",
    orgId: apiKey.orgId,
    userId: null,
    role: null,
    permissions: sanitizeScopes(apiKey.scopes),
    isInstanceAdmin: false,
    apiKeyId: apiKey.id,
    ip,
    requestId,
  };
}
