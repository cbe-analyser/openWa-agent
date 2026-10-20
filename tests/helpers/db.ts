import type { Role } from "@prisma/client";
import { prisma } from "@/server/db";
import { ROLE_PERMISSIONS } from "@/server/auth/permissions";
import type { AuthContext } from "@/server/auth/context";
import { createOrganization } from "@/server/services/orgs";
import { hashPassword } from "@/server/security/passwords";
import { createSession, sessionCookieName } from "@/server/auth/sessions";

export async function resetDb() {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length)
    await prisma.$executeRawUnsafe(
      `TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`,
    );
}

let counter = 0;
export const TEST_PASSWORD = "Correct-Horse-42!";

/** Creates an organization (sandbox setup: simulator channel + mock provider) with one member. */
export async function createOrgWithUser(
  role: Role = "OWNER",
  opts: { sandbox?: boolean; name?: string } = {},
) {
  counter++;
  const org = await prisma.$transaction((tx) =>
    createOrganization(tx, opts.name ?? `Org ${counter} ${Date.now()}`, { sandbox: opts.sandbox ?? true }),
  );
  const user = await prisma.user.create({
    data: {
      email: `user${counter}-${Date.now()}@example.com`,
      name: `User ${counter}`,
      passwordHash: await hashPassword(TEST_PASSWORD),
    },
  });
  await prisma.membership.create({ data: { userId: user.id, orgId: org.id, role } });
  return { org, user, ctx: ctxFor(org.id, user.id, role) };
}

export function ctxFor(
  orgId: string,
  userId: string | null,
  role: Role,
  extra: Partial<AuthContext> = {},
): AuthContext {
  return {
    kind: "session",
    orgId,
    userId,
    role,
    permissions: ROLE_PERMISSIONS[role],
    isInstanceAdmin: false,
    ip: "127.0.0.1",
    requestId: "test",
    ...extra,
  };
}

export async function sessionCookie(userId: string, orgId: string): Promise<string> {
  const { token } = await createSession(userId, orgId, "127.0.0.1", "vitest");
  return `${sessionCookieName()}=${token}`;
}

export async function simulatorChannel(orgId: string) {
  return prisma.channel.findFirstOrThrow({ where: { orgId, kind: "SIMULATOR" } });
}
