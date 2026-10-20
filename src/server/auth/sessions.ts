import type { Role } from "@prisma/client";
import { prisma } from "../db";
import { env } from "../env";
import { randomToken, sha256Hex } from "../security/crypto";
import { ROLE_PERMISSIONS } from "./permissions";
import type { AuthContext } from "./context";

export function sessionCookieName(): string {
  return env().APP_URL.startsWith("https://") ? "__Host-owa_session" : "owa_session";
}

export function sessionCookieOptions(expires: Date) {
  return {
    httpOnly: true,
    secure: env().APP_URL.startsWith("https://"),
    sameSite: "lax" as const,
    path: "/",
    expires,
  };
}

export async function createSession(
  userId: string,
  activeOrgId: string | null,
  ip: string | null,
  userAgent: string | null,
) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + env().SESSION_TTL_HOURS * 3600 * 1000);
  const session = await prisma.session.create({
    data: {
      tokenHash: sha256Hex(token),
      userId,
      activeOrgId,
      ip,
      userAgent: userAgent?.slice(0, 300) ?? null,
      expiresAt,
    },
  });
  return { token, session };
}

export async function destroySession(token: string) {
  await prisma.session.deleteMany({ where: { tokenHash: sha256Hex(token) } });
}

/** Resolves a session token into an authorization context for the session's active org. */
export async function resolveSession(
  token: string,
  ip: string | null,
  requestId: string,
): Promise<AuthContext | null> {
  if (!token || token.length > 200) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256Hex(token) },
    include: { user: { include: { memberships: true } } },
  });
  if (!session || session.expiresAt < new Date() || session.user.disabled) return null;

  // The active organization must be one the user is still a member of (re-checked on every request).
  let membership = session.user.memberships.find((m) => m.orgId === session.activeOrgId);
  if (!membership) membership = session.user.memberships[0];
  if (!membership) return null;

  if (Date.now() - session.lastSeenAt.getTime() > 5 * 60 * 1000) {
    await prisma.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date(), activeOrgId: membership.orgId },
    });
  }

  return {
    kind: "session",
    orgId: membership.orgId,
    userId: session.userId,
    role: membership.role as Role,
    permissions: ROLE_PERMISSIONS[membership.role],
    isInstanceAdmin: session.user.isInstanceAdmin,
    sessionId: session.id,
    ip,
    requestId,
  };
}
