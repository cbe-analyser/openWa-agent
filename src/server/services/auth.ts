import { prisma } from "../db";
import { badRequest, notFound, unauthorized } from "../errors";
import { hashPassword, validatePasswordStrength, verifyPassword } from "../security/passwords";
import { randomToken, sha256Hex } from "../security/crypto";
import { rateLimit } from "../security/ratelimit";
import { createSession } from "../auth/sessions";
import { ROLE_RANK } from "../auth/permissions";
import { requirePermission, type AuthContext } from "../auth/context";
import type { Role } from "@prisma/client";
import { audit, auditCtx } from "./audit";

const LOCK_AFTER = 8;
const LOCK_MINUTES = 15;
// Pre-computed hash used to equalize timing when the email does not exist.
let dummyHash: Promise<string> | null = null;

export async function login(emailRaw: string, password: string, ip: string | null, userAgent: string | null) {
  const email = emailRaw.trim().toLowerCase();
  const rl = await rateLimit(`login:${ip ?? "unknown"}:${email}`, 10, 15 * 60);
  if (!rl.allowed) throw unauthorized("Too many login attempts. Try again later.");
  const user = await prisma.user.findUnique({
    where: { email },
    include: { memberships: { orderBy: { createdAt: "asc" } } },
  });
  if (!user) {
    dummyHash ??= hashPassword("dummy-password-for-timing");
    await verifyPassword(password, await dummyHash);
    throw unauthorized("Invalid email or password");
  }
  if (user.disabled) throw unauthorized("Invalid email or password");
  if (user.lockedUntil && user.lockedUntil > new Date())
    throw unauthorized("Account temporarily locked after failed attempts. Try again later.");
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    const failed = user.failedLogins + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLogins: failed >= LOCK_AFTER ? 0 : failed,
        lockedUntil: failed >= LOCK_AFTER ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
      },
    });
    await audit({
      orgId: user.memberships[0]?.orgId ?? null,
      actorType: "USER",
      actorId: user.id,
      action: "auth.login_failed",
      ip,
    });
    throw unauthorized("Invalid email or password");
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  const orgId = user.memberships[0]?.orgId ?? null;
  const { token, session } = await createSession(user.id, orgId, ip, userAgent);
  await audit({ orgId, actorType: "USER", actorId: user.id, action: "auth.login", ip });
  return { token, session, user };
}

export async function changePassword(ctx: AuthContext, current: string, next: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: ctx.userId! } });
  if (!(await verifyPassword(current, user.passwordHash))) throw badRequest("Current password is incorrect");
  const err = validatePasswordStrength(next);
  if (err) throw badRequest(err);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next) } });
  // Invalidate all other sessions after a password change.
  await prisma.session.deleteMany({ where: { userId: user.id, id: { not: ctx.sessionId } } });
  await auditCtx(ctx, "auth.password_changed", { type: "user", id: user.id });
}

export async function switchOrganization(ctx: AuthContext, orgId: string) {
  const m = await prisma.membership.findUnique({ where: { userId_orgId: { userId: ctx.userId!, orgId } } });
  if (!m) throw notFound("Organization");
  await prisma.session.update({
    where: { id: ctx.sessionId! },
    data: { activeOrgId: orgId, lastSeenAt: new Date() },
  });
}

export async function createInvitation(ctx: AuthContext, email: string, role: Role) {
  requirePermission(ctx, "team:manage");
  if (role === "OWNER" && ctx.role !== "OWNER") throw badRequest("Only owners can invite owners");
  const token = randomToken(24);
  const inv = await prisma.invitation.create({
    data: {
      orgId: ctx.orgId,
      email: email.trim().toLowerCase(),
      role,
      tokenHash: sha256Hex(token),
      expiresAt: new Date(Date.now() + 7 * 86400_000),
      createdById: ctx.userId,
    },
  });
  await auditCtx(ctx, "team.invited", { type: "invitation", id: inv.id }, { email: inv.email, role });
  return { invitation: inv, token };
}

export async function acceptInvitation(
  token: string,
  input: { name: string; password: string },
  ip: string | null,
  ua: string | null,
) {
  const inv = await prisma.invitation.findUnique({ where: { tokenHash: sha256Hex(token) } });
  if (!inv || inv.acceptedAt || inv.expiresAt < new Date())
    throw badRequest("This invitation is invalid or has expired");
  let user = await prisma.user.findUnique({ where: { email: inv.email } });
  if (!user) {
    const err = validatePasswordStrength(input.password);
    if (err) throw badRequest(err);
    user = await prisma.user.create({
      data: { email: inv.email, name: input.name, passwordHash: await hashPassword(input.password) },
    });
  } else if (!(await verifyPassword(input.password, user.passwordHash))) {
    throw badRequest("An account with this email exists; enter its current password to join");
  }
  await prisma.$transaction([
    prisma.membership.upsert({
      where: { userId_orgId: { userId: user.id, orgId: inv.orgId } },
      create: { userId: user.id, orgId: inv.orgId, role: inv.role },
      update: {},
    }),
    prisma.invitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } }),
  ]);
  await audit({
    orgId: inv.orgId,
    actorType: "USER",
    actorId: user.id,
    action: "team.joined",
    targetType: "user",
    targetId: user.id,
    ip,
  });
  return createSession(user.id, inv.orgId, ip, ua);
}

export async function updateMemberRole(ctx: AuthContext, userId: string, role: Role) {
  requirePermission(ctx, "team:manage");
  const target = await prisma.membership.findUnique({
    where: { userId_orgId: { userId, orgId: ctx.orgId } },
  });
  if (!target) throw notFound("Member");
  if (userId === ctx.userId) throw badRequest("You cannot change your own role");
  if (
    (ROLE_RANK[target.role] >= ROLE_RANK[ctx.role!] || ROLE_RANK[role] > ROLE_RANK[ctx.role!]) &&
    ctx.role !== "OWNER"
  ) {
    throw badRequest("You cannot change the role of a member with equal or higher privileges");
  }
  if (target.role === "OWNER" && role !== "OWNER") {
    const owners = await prisma.membership.count({ where: { orgId: ctx.orgId, role: "OWNER" } });
    if (owners <= 1) throw badRequest("An organization must keep at least one owner");
  }
  await prisma.membership.update({ where: { id: target.id }, data: { role } });
  await auditCtx(ctx, "team.role_changed", { type: "user", id: userId }, { from: target.role, to: role });
}

export async function removeMember(ctx: AuthContext, userId: string) {
  requirePermission(ctx, "team:manage");
  const target = await prisma.membership.findUnique({
    where: { userId_orgId: { userId, orgId: ctx.orgId } },
  });
  if (!target) throw notFound("Member");
  if (userId === ctx.userId) throw badRequest("You cannot remove yourself");
  if (ROLE_RANK[target.role] >= ROLE_RANK[ctx.role!] && ctx.role !== "OWNER")
    throw badRequest("Insufficient privileges");
  if (
    target.role === "OWNER" &&
    (await prisma.membership.count({ where: { orgId: ctx.orgId, role: "OWNER" } })) <= 1
  ) {
    throw badRequest("An organization must keep at least one owner");
  }
  await prisma.$transaction([
    prisma.membership.delete({ where: { id: target.id } }),
    prisma.session.updateMany({ where: { userId, activeOrgId: ctx.orgId }, data: { activeOrgId: null } }),
    prisma.conversation.updateMany({
      where: { orgId: ctx.orgId, assignedToId: userId },
      data: { assignedToId: null },
    }),
  ]);
  await auditCtx(ctx, "team.removed", { type: "user", id: userId });
}
