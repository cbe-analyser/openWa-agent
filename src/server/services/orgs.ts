import type { Role } from "@prisma/client";
import { prisma, type Tx } from "../db";
import { env } from "../env";
import { badRequest, conflict, forbidden } from "../errors";
import { hashPassword, validatePasswordStrength } from "../security/passwords";
import { BUILTIN_TOOLS } from "../tools/builtin";

export function slugify(name: string): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "org";
  return `${base}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Creates an organization with safe defaults: copilot mode, built-in tools, local embeddings. */
export async function createOrganization(tx: Tx, name: string, opts: { sandbox?: boolean } = {}) {
  const org = await tx.organization.create({ data: { name, slug: slugify(name) } });
  await tx.embeddingConfig.create({ data: { orgId: org.id } });
  for (const t of BUILTIN_TOOLS) {
    await tx.toolConfig.create({
      data: {
        orgId: org.id,
        name: t.name,
        kind: "BUILTIN",
        description: t.description,
        permission: t.permission,
        enabled: true,
        timeoutMs: t.timeoutMs,
      },
    });
  }
  if (opts.sandbox) {
    await tx.channel.create({
      data: {
        orgId: org.id,
        kind: "SIMULATOR",
        name: "Simulator",
        status: "ACTIVE",
        phoneNumberId: `sim-${org.id}`,
      },
    });
    await tx.aIProviderConfig.create({
      data: {
        orgId: org.id,
        name: "Mock (development only)",
        kind: "MOCK",
        model: "mock-rules-v1",
        isPrimary: true,
        maxOutputTokens: 800,
      },
    });
  }
  return org;
}

export async function signupAllowed(): Promise<boolean> {
  const e = env();
  const orgCount = await prisma.organization.count();
  if (orgCount === 0) return true; // first-run bootstrap
  if (e.DEPLOYMENT_MODE === "single") return false;
  return e.ALLOW_SIGNUP || e.DEPLOYMENT_MODE === "sandbox";
}

export async function registerOwner(input: {
  email: string;
  name: string;
  password: string;
  orgName: string;
}) {
  if (!(await signupAllowed())) throw forbidden("Self-service sign-up is disabled on this installation");
  const pwError = validatePasswordStrength(input.password);
  if (pwError) throw badRequest(pwError);
  const email = input.email.trim().toLowerCase();
  if (await prisma.user.findUnique({ where: { email } }))
    throw conflict("An account with this email already exists");
  const passwordHash = await hashPassword(input.password);
  const firstUser = (await prisma.user.count()) === 0;
  return prisma.$transaction(async (tx) => {
    const org = await createOrganization(tx, input.orgName, { sandbox: env().DEPLOYMENT_MODE === "sandbox" });
    const user = await tx.user.create({
      data: { email, name: input.name, passwordHash, isInstanceAdmin: firstUser },
    });
    await tx.membership.create({ data: { userId: user.id, orgId: org.id, role: "OWNER" } });
    await tx.auditLog.create({
      data: {
        orgId: org.id,
        actorType: "USER",
        actorId: user.id,
        action: "organization.created",
        targetType: "organization",
        targetId: org.id,
      },
    });
    return { user, org };
  });
}

export async function addMembership(tx: Tx, userId: string, orgId: string, role: Role) {
  return tx.membership.upsert({
    where: { userId_orgId: { userId, orgId } },
    create: { userId, orgId, role },
    update: { role },
  });
}
